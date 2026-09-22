const assert = require("node:assert/strict");
const { chromium } = require(process.env.WRAVA_PLAYWRIGHT || "playwright-core");

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.WRAVA_BROWSER_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    // Exercise the real production frontend against a controllable desktop IPC boundary.
    await page.addInitScript(() => {
      const stats = Object.fromEntries(["today", "week", "month", "year"].flatMap(period =>
        ["Added", "Net", "Documents"].map(metric => [period + metric, 0])));
      const docs = {
        "first.md": { path: "first.md", content: "# First\n\nOriginal words.\n", tags: [], wordCount: 3 },
        "second.md": { path: "second.md", content: "# Second\n\nOther writing.\n", tags: [], wordCount: 3 },
      };
      const workspace = { root: "C:\\Writing", files: Object.keys(docs), stats };
      window.testStorage = { docs, calls: [], delay: 0, fail: false, active: 0, maxActive: 0 };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        invoke: async (command, args) => {
          if (command === "plugin:window|set_theme") return;
          if (command === "plugin:dialog|open") return workspace.root;
          if (command === "open_workspace" || command === "refresh_workspace") return structuredClone(workspace);
          if (command === "read_document") return structuredClone(docs[args.path]);
          if (command === "save_document") {
            const test = window.testStorage;
            test.calls.push({ ...args, time: performance.now() });
            test.active++;
            test.maxActive = Math.max(test.maxActive, test.active);
            try {
              await new Promise(resolve => setTimeout(resolve, test.delay));
              if (test.fail) throw new Error("Disk is read-only");
              const tags = [...new Set(args.tags.map(tag => tag.toLowerCase()))].sort();
              const body = args.content.replace(/^---\n[\s\S]*?\n---\n/, "");
              const content = tags.length ? `---\ntags: [${tags.join(", ")}]\n---\n${body}` : body;
              docs[args.path] = { ...docs[args.path], content, tags };
              return structuredClone({ workspace, document: docs[args.path] });
            } finally { test.active--; }
          }
          throw new Error(`Unexpected IPC: ${command}`);
        },
      };
    });
    const url = process.env.WRAVA_TEST_URL || "http://localhost:1421/";
    await page.goto(url, { waitUntil: "networkidle" });
    const button = name => page.getByRole("button", { name, exact: true });
    const settings = async callback => {
      await button("Settings").click();
      await callback();
      await button("Save settings").click();
      await page.locator(".settings-panel").waitFor({ state: "detached" });
    };
    const saved = () => button("Saved").waitFor();
    const count = () => page.evaluate(() => window.testStorage.calls.length);
    await button("Switch to dark mode").click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await settings(async () => {
      assert.equal(await page.getByLabel("Autosave", { exact: true }).isChecked(), true);
      assert.equal(await page.getByLabel("Colour theme").inputValue(), "dark");
      await page.getByRole("slider").fill("24");
    });
    await button("Choose writing folder").first().click();
    await page.locator(".file-button").first().click();
    const rich = page.locator(".ProseMirror");
    await rich.waitFor();
    assert.equal(await rich.evaluate(el => getComputedStyle(el).fontSize), "24px");
    await settings(async () => { await page.getByLabel("Autosave", { exact: true }).uncheck(); });
    for (const mode of ["rich", "source"]) {
      if (mode === "source") await button("Markdown source").click();
      const editor = page.locator(mode === "rich" ? ".ProseMirror" : ".cm-content");
      await editor.evaluate(el => { window.titleEditor = el; });
      await editor.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText(" Body edit before title.");
      await button("Save").waitFor();
      await button("Edit writing title: First").click();
      await page.getByRole("textbox", { name: "Writing title", exact: true }).fill("Changed *title*");
      await button("Apply writing title").click();
      await button("Edit writing title: Changed *title*").waitFor();
      assert.equal(await editor.evaluate(el => el === window.titleEditor), true, "Title edits retain the editor");
      await editor.click();
      await page.keyboard.press("Control+z");
      await button("Edit writing title: First").waitFor().catch(async error => {
        console.error("Title undo failed:", mode, await editor.innerText(), await page.locator(".document-heading").innerText(), errors);
        throw error;
      });
      assert.match(await editor.innerText(), /Body edit before title/);
      await page.keyboard.press("Control+z");
      assert.doesNotMatch(await editor.innerText(), /Body edit before title/);
    }
    await button("Rich editor").click();
    await settings(async () => { await page.getByLabel("Autosave", { exact: true }).check(); });
    await rich.evaluate(el => { window.originalEditor = el; });
    await rich.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" Added with autosave.");
    const selection = await page.evaluate(() => window.getSelection().anchorOffset);
    await button("Save").waitFor();
    await saved();
    assert.equal(await rich.evaluate(el => window.originalEditor === el && el === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.getSelection().anchorOffset), selection);
    assert.match(await page.evaluate(() => window.testStorage.docs["first.md"].content), /Added with autosave/);
    await page.keyboard.press("Control+z");
    assert.doesNotMatch(await rich.innerText(), /Added with autosave/);
    await button("Save").waitFor();
    await saved();

    await button("Markdown source").click();
    const source = page.locator(".cm-content");
    assert.equal(await source.evaluate(el => getComputedStyle(el).fontSize), "24px");
    const initial = await count();
    await source.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nDebounced");
    await page.waitForTimeout(1300);
    await page.keyboard.insertText(" writing");
    await page.waitForTimeout(1100);
    assert.equal(await count(), initial, "Editing restarts the two-second timer");
    await saved();
    assert.equal(await count(), initial + 1);

    await page.evaluate(() => { window.testStorage.delay = 1800; });
    await source.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" first snapshot");
    await page.keyboard.press("Control+s");
    await button("Saving…").waitFor();
    await page.keyboard.insertText(" newer edit");
    await page.getByLabel("Tags", { exact: true }).fill("new-tag");
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => window.testStorage.active === 0);
    assert.match(await source.innerText(), /newer edit/);
    assert.equal(await page.getByLabel("Tags", { exact: true }).inputValue(), "new-tag");
    assert.equal(await button("Save").isEnabled(), true);
    await page.evaluate(() => { window.testStorage.delay = 0; });
    await saved();
    assert.match(await page.evaluate(() => window.testStorage.docs["first.md"].content), /newer edit/);
    assert.deepEqual(await page.evaluate(() => window.testStorage.docs["first.md"].tags), ["new-tag"]);
    assert.equal(await page.evaluate(() => window.testStorage.maxActive), 1);

    await button("Rich editor").click();
    await rich.waitFor();
    await page.evaluate(() => { window.testStorage.delay = 200; });
    await rich.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" quick save");
    await page.keyboard.press("Control+s");
    await button("Saving…").waitFor();
    await page.keyboard.insertText(" newer rich edit");
    await page.waitForFunction(() => window.testStorage.active === 0);
    assert.match(await rich.innerText(), /newer rich edit/);
    await page.evaluate(() => { window.testStorage.delay = 0; });
    await button("Save").waitFor();
    await saved();
    assert.match(await page.evaluate(() => window.testStorage.docs["first.md"].content), /newer rich edit/);
    await button("Markdown source").click();

    await page.evaluate(() => { window.testStorage.fail = true; });
    await source.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" retained after failure");
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /Autosave failed.*Disk is read-only/);
    const failedCount = await count();
    await page.waitForTimeout(2500);
    assert.equal(await count(), failedCount, "Failures do not cause a retry loop");
    assert.match(await source.innerText(), /retained after failure/);
    await page.evaluate(() => { window.testStorage.fail = false; });
    await button("Save").click();
    await saved();
    assert.equal(await page.getByRole("alert").count(), 0);

    await settings(async () => {
      await page.getByLabel("Autosave", { exact: true }).uncheck();
      await page.getByRole("slider").fill("28");
    });
    assert.equal(await source.evaluate(el => getComputedStyle(el).fontSize), "28px");
    const manualCount = await count();
    await source.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" manual only");
    await page.waitForTimeout(2600);
    assert.equal(await count(), manualCount);
    await page.keyboard.press("Control+s");
    await saved();
    await settings(async () => { await page.getByLabel("Autosave", { exact: true }).check(); });
    const switchCount = await count();
    await source.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" discard pending edit");
    await page.locator(".file-button").nth(1).click();
    await page.waitForTimeout(2600);
    assert.equal(await count(), switchCount, "Switching documents cancels the old document's timer");
    assert.doesNotMatch(await page.evaluate(() => window.testStorage.docs["first.md"].content), /discard pending/);
    assert.doesNotMatch(await source.innerText(), /discard pending/);
    await settings(async () => { await page.getByLabel("Autosave", { exact: true }).uncheck(); });
    await button("Settings").click();
    await page.getByLabel("Autosave", { exact: true }).check();
    await page.getByRole("slider").fill("12");
    await button("Cancel").click();
    assert.equal(await source.evaluate(el => getComputedStyle(el).fontSize), "28px");
    await button("Switch to light mode").click();
    await page.reload({ waitUntil: "networkidle" });
    await button("Settings").click();
    assert.equal(await page.getByLabel("Autosave", { exact: true }).isChecked(), false);
    assert.equal(await page.getByRole("slider").inputValue(), "28");
    assert.equal(await page.getByLabel("Colour theme").inputValue(), "light");
    await page.setViewportSize({ width: 760, height: 640 });
    if (process.env.WRAVA_SCREENSHOT_DIR) {
      await page.screenshot({ path: require("node:path").join(process.env.WRAVA_SCREENSHOT_DIR, "wrava-writing-settings.png") });
    }
    await button("Save settings").scrollIntoViewIfNeeded();
    assert.equal(await button("Save settings").isVisible(), true);
    await button("Save settings").click();
    await button("Choose writing folder").first().click();
    await page.locator(".file-button").first().click();
    await settings(async () => { await page.getByRole("slider").fill("12"); });
    assert.equal(await rich.evaluate(el => getComputedStyle(el).fontSize), "12px");
    if (process.env.WRAVA_SCREENSHOT_DIR) {
      await page.screenshot({ path: require("node:path").join(process.env.WRAVA_SCREENSHOT_DIR, "wrava-writing-controls-narrow.png") });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    const demo = await browser.newPage();
    demo.on("pageerror", error => errors.push(error.message));
    await demo.goto(url, { waitUntil: "networkidle" });
    await demo.getByRole("button", { name: "Choose writing folder", exact: true }).first().click();
    await demo.locator(".file-button").first().click();
    await demo.getByRole("button", { name: "Markdown source", exact: true }).click();
    await demo.locator(".cm-content").click();
    await demo.keyboard.press("Control+End");
    await demo.keyboard.insertText("\nAutosave in the browser demo.");
    await demo.getByRole("button", { name: "Save", exact: true }).waitFor();
    await demo.getByRole("button", { name: "Saved", exact: true }).waitFor();
    await demo.locator(".file-button").nth(1).click();
    await demo.locator(".file-button").first().click();
    assert.match(await demo.locator(".cm-content").innerText(), /Autosave in the browser demo/);
    assert.deepEqual(errors, []);
    console.log("PASS: theme shortcut, sizing, debounce, save snapshots, concurrent edits, undo/cursor, failures, opt-out and persistence");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
