import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsView } from "./types";

export function AnalyticsPage({ analytics }: { analytics: AnalyticsView }) {
  const totalAdded = analytics.daily.reduce((sum, day) => sum + day.wordsAdded, 0);
  const totalNet = analytics.daily.reduce((sum, day) => sum + day.netChange, 0);
  const bestDay = analytics.daily.reduce(
    (best, day) => (day.wordsAdded > best.wordsAdded ? day : best),
    analytics.daily[0],
  );
  const maxDocumentWords = Math.max(
    1,
    ...analytics.documents.map((document) => document.wordsAdded),
  );

  return (
    <section className="analytics-page">
      <div className="analytics-heading">
        <div>
          <p className="eyebrow">Detailed analytics</p>
          <h1>Your last 12 weeks</h1>
          <p>Writing activity calculated from accepted Markdown changes.</p>
        </div>
      </div>

      <div className="analytics-summary">
        <SummaryCard label="Words added" value={totalAdded} detail={`${totalNet >= 0 ? "+" : ""}${totalNet.toLocaleString()} net growth`} />
        <SummaryCard label="Active days" value={analytics.activeDays} detail={`of ${analytics.daily.length} days`} />
        <SummaryCard label="Active documents" value={analytics.activeDocuments} detail={`${analytics.documents.length} in the workspace`} />
        <SummaryCard label="Current corpus" value={analytics.currentWordCount} detail={`${analytics.documents.length} documents`} />
        <SummaryCard
          label="Best writing day"
          value={bestDay?.wordsAdded ?? 0}
          detail={bestDay ? formatDate(bestDay.date) : "No activity yet"}
        />
      </div>

      <div className="analytics-grid">
        <article className="analytics-card trend-card">
          <div className="card-heading">
            <div>
              <h2>Writing activity</h2>
              <p>Daily additions and net document growth</p>
            </div>
            <span>12 weeks</span>
          </div>
          <div className="trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.daily} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  minTickGap={36}
                  tick={{ fill: "var(--chart-label)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="words"
                  tick={{ fill: "var(--chart-label)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="documents"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: "var(--chart-label)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(label) => formatDate(String(label))}
                  contentStyle={{ borderRadius: 10, borderColor: "var(--tooltip-border)", background: "var(--tooltip-background)", color: "var(--tooltip-text)" }}
                />
                <Line
                  type="monotone"
                  dataKey="wordsAdded"
                  name="Words added"
                  yAxisId="words"
                  stroke="var(--chart-added)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="netChange"
                  name="Net growth"
                  yAxisId="words"
                  stroke="var(--chart-net)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="activeDocuments"
                  name="Active documents"
                  yAxisId="documents"
                  stroke="var(--chart-documents)"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span><i className="legend-added" /> Words added</span>
            <span><i className="legend-net" /> Net growth</span>
            <span><i className="legend-documents" /> Active documents</span>
          </div>
        </article>

        <article className="analytics-card consistency-card">
          <div className="card-heading">
            <div>
              <h2>Consistency</h2>
              <p>Each square is one day</p>
            </div>
          </div>
          <div className="activity-grid" aria-label="Writing activity heatmap">
            {analytics.daily.map((day) => (
              <span
                key={day.date}
                className={`activity-cell level-${activityLevel(day.wordsAdded)}`}
                title={`${formatDate(day.date)}: ${day.wordsAdded.toLocaleString()} words added`}
              />
            ))}
          </div>
          <p className="consistency-note">
            You wrote on <strong>{analytics.activeDays}</strong> of the last 84 days.
          </p>
        </article>

        <article className="analytics-card documents-card">
          <div className="card-heading">
            <div>
              <h2>Activity by document</h2>
              <p>All recorded activity for the current workspace</p>
            </div>
          </div>
          <div className="document-breakdown">
            {analytics.documents.length ? analytics.documents.map((item) => (
              <div className="document-row" key={item.path}>
                <div className="document-row-label">
                  <strong title={item.path}>{item.path}</strong>
                  <span>{item.wordsAdded.toLocaleString()} added · {item.currentWordCount.toLocaleString()} current</span>
                  {item.tags.length > 0 && (
                    <span className="document-tags">{item.tags.map((tag) => `#${tag}`).join(" ")}</span>
                  )}
                </div>
                <div className="document-bar-track">
                  <span
                    className={item.wordsAdded === 0 ? "document-bar zero" : "document-bar"}
                    style={{ width: `${item.wordsAdded === 0 ? 0 : item.wordsAdded / maxDocumentWords * 100}%` }}
                  />
                </div>
                <span className={item.netChange < 0 ? "document-net negative" : "document-net"}>
                  {item.netChange >= 0 ? "+" : ""}{item.netChange.toLocaleString()}
                </span>
              </div>
            )) : (
              <p className="empty-analytics">No documents have been indexed yet.</p>
            )}
          </div>
        </article>

        <article className="analytics-card tags-card">
          <div className="card-heading">
            <div>
              <h2>Activity by tag</h2>
              <p>Current tags applied to each document</p>
            </div>
          </div>
          <div className="tag-breakdown">
            {analytics.tags.length ? analytics.tags
              .slice()
              .sort((left, right) => right.wordsAdded - left.wordsAdded)
              .map((tag) => (
                <div className="tag-row" key={tag.tag}>
                  <span className="tag-pill">#{tag.tag}</span>
                  <strong>{tag.wordsAdded.toLocaleString()} words</strong>
                  <span>{tag.documents} document{tag.documents === 1 ? "" : "s"}</span>
                </div>
              )) : (
              <p className="empty-analytics">Add tags to documents to see topic-level activity.</p>
            )}
          </div>
        </article>

        <article className="analytics-card bigram-card">
          <div className="card-heading">
            <div>
              <h2>Writing patterns</h2>
              <p>Most frequent two-word pairs · stopwords removed</p>
            </div>
          </div>
          <div className="bigram-breakdown">
            {analytics.bigrams.length ? analytics.bigrams.map((item) => (
              <div className="bigram-row" key={item.phrase}>
                <span className="bigram-phrase">"{item.phrase}"</span>
                <span className="bigram-count">{item.count}</span>
              </div>
            )) : (
              <p className="empty-analytics">Write more to see common phrases.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <small>{detail}</small>
    </article>
  );
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function activityLevel(words: number) {
  if (words === 0) return 0;
  if (words < 100) return 1;
  if (words < 300) return 2;
  if (words < 600) return 3;
  return 4;
}
