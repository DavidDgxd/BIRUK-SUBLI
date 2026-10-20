const STEPS = [
  {
    title: 'Search the ledger',
    text: 'Describe the item or add a photo. No account needed.',
  },
  {
    title: 'Note the office',
    text: 'Results name the counter, its address and its hours.',
  },
  {
    title: 'Collect in person',
    text: 'Bring a valid ID and describe the item at the counter.',
  },
];

export default function HowItWorks() {
  return (
    <section className="steps" aria-labelledby="how-title">
      <h2 id="how-title">How it works</h2>
      <ol className="steps__list">
        {STEPS.map((step, index) => (
          <li className="step" key={step.title}>
            <span className="step__num" aria-hidden="true">
              {index + 1}
            </span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
