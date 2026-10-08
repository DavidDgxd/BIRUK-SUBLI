import Icon from './Icon.jsx';

const STEPS = [
  {
    icon: 'search',
    title: 'Search or report',
    text: 'Describe your item in English or Filipino, or upload a photo. No account needed.',
  },
  {
    icon: 'location_on',
    title: 'Find the holding office',
    text: 'Results show the office, address, operating hours, and the proof of ownership to bring.',
  },
  {
    icon: 'badge',
    title: 'Claim in person',
    text: 'Items are verified and released at the office counter after an ID check. There are no online claims or messaging.',
  },
];

// Examples of participating desks. The full list is managed by BCPIO / MITD.
const DESKS = [
  'Baguio City Public Information Office',
  'City Hall Information Desk',
  'Baguio Market Office',
];

export default function HowItWorks() {
  return (
    <section aria-labelledby="how-title">
      <h2 className="how__title" id="how-title">
        How it works
      </h2>
      <p className="how__lede">
        Biruk-Subli helps you find out where a lost item is being kept. The item
        stays with a city office until its owner collects it.
      </p>
      <ol className="how__steps">
        {STEPS.map((step) => (
          <li className="how-step" key={step.title}>
            <div className="how-step__icon">
              <Icon name={step.icon} />
            </div>
            <div>
              <h3 className="how-step__title">{step.title}</h3>
              <p className="how-step__text">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="desks">
        <h3 className="desks__title">Participating desks include</h3>
        <ul className="desks__list">
          {DESKS.map((desk) => (
            <li className="desks__item" key={desk}>
              <Icon name="apartment" />
              {desk}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
