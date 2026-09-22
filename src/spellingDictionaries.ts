import { createSpellingChecker, type SpellingChecker } from "./spellcheckCore";

export type DictionaryLanguage = "en-GB" | "en-US";
const dictionaries = new Map<DictionaryLanguage, Promise<SpellingChecker>>();

export function loadDictionary(language: DictionaryLanguage): Promise<SpellingChecker> {
  const existing = dictionaries.get(language);
  if (existing) return existing;
  const sources = language === "en-GB"
    ? Promise.all([
      import("../node_modules/dictionary-en-gb/index.aff?raw"),
      import("../node_modules/dictionary-en-gb/index.dic?raw"),
    ])
    : Promise.all([
      import("../node_modules/dictionary-en/index.aff?raw"),
      import("../node_modules/dictionary-en/index.dic?raw"),
    ]);
  const loaded = sources.then(([aff, dic]) => createSpellingChecker(aff.default, dic.default))
    .catch((error) => {
      dictionaries.delete(language);
      throw new Error(`Could not load the ${language} spelling dictionary: ${String(error)}`);
    });
  dictionaries.set(language, loaded);
  return loaded;
}
