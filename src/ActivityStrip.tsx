import type { Settings } from "./settings";
import type { ActivityStats } from "./types";
import { goalProgress } from "./writingProgress";

export function ActivityStrip({ stats, settings, pace, compact }: {
  stats: ActivityStats;
  settings: Settings;
  pace: { average: number; needed: number };
  compact: boolean;
}) {
  if (compact) {
    return (
      <div className="metric-strip-compact" aria-label="Writing activity summary">
        <strong>{stats.todayAdded.toLocaleString()}</strong>
        <span>words added today</span>
        <span className={stats.todayNet < 0 ? "negative" : ""}>
          {stats.todayNet >= 0 ? "+" : ""}{stats.todayNet.toLocaleString()} net growth
        </span>
      </div>
    );
  }

  return (
    <section className="metric-strip" aria-label="Writing activity">
      <div className="metric-primary">
        <MetricCard label="Today" added={stats.todayAdded} net={stats.todayNet}
          documents={stats.todayDocuments} goal={settings.goals.today} />
        <MetricCard label="This week" added={stats.weekAdded} net={stats.weekNet}
          documents={stats.weekDocuments} goal={settings.goals.week}
          pace={`${pace.average.toLocaleString()} net words per calendar day on average`}
          catchup={settings.goals.week > 0 && stats.weekNet < settings.goals.week
            ? `${Math.ceil((settings.goals.week - stats.weekNet) / pace.needed).toLocaleString()} per day needed, including today`
            : undefined} />
      </div>
      <details className="more-activity">
        <summary>Month and year <span>See longer-term activity</span></summary>
        <div className="metric-secondary">
          <MetricCard label="This month" added={stats.monthAdded} net={stats.monthNet}
            documents={stats.monthDocuments} goal={settings.goals.month} />
          <MetricCard label="This year" added={stats.yearAdded} net={stats.yearNet}
            documents={stats.yearDocuments} goal={settings.goals.year} />
        </div>
      </details>
    </section>
  );
}

function MetricCard({
  label,
  added,
  net,
  documents,
  goal,
  pace,
  catchup,
}: {
  label: string;
  added: number;
  net: number;
  documents: number;
  goal: number;
  pace?: string;
  catchup?: string;
}) {
  const progress = goalProgress(net, goal);
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong className={net < 0 ? "negative" : ""}>{net >= 0 ? "+" : ""}{net.toLocaleString()} <em>net words</em></strong>
      {goal > 0 && <>
        <div className="goal-track" role="progressbar" aria-label={`${label} goal progress`}
          aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(goal, Math.max(0, net))}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <small className="goal-caption">{net >= goal ? "Goal reached" : `${Math.max(0, goal - net).toLocaleString()} to go`}
          {" · "}{goal.toLocaleString()} net words target</small>
      </>}
      {pace && <small className="pace-caption">{pace}</small>}
      {catchup && <small className="pace-caption">{catchup}</small>}
      <small>{added.toLocaleString()} added</small>
      <small className="document-count">
        {documents} active document{documents === 1 ? "" : "s"}
      </small>
    </article>
  );
}