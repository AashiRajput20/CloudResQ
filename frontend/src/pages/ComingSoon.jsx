// Placeholder for pages that are built in later phases.
export default function ComingSoon({ title, phase }) {
  return (
    <div className="container">
      <h2 className="page-title">{title}</h2>
      <section className="card">
        <p className="muted">This page will be built in {phase}.</p>
      </section>
    </div>
  );
}