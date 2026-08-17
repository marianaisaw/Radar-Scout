/** Slim icon rail — one button per pooled fibrosis disease. */

const LOGO_URL = `${import.meta.env.BASE_URL || '/'}logo.png`

function navTone(disease) {
  const d = (disease || '').toLowerCase()
  if (d.includes('cardiac')) return 'cardiac'
  if (d.includes('keloid')) return 'keloid'
  if (d.includes('kidney')) return 'kidney'
  if (d.includes('liver')) return 'liver'
  if (d.includes('pulmonary')) return 'pulmonary'
  return 'default'
}

function navLabel(disease) {
  if (!disease) return ''
  return disease
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function sortDiseases(diseases) {
  return [...diseases].sort((a, b) => {
    const aIsKeloid = (a.disease || '').toLowerCase() === 'keloid'
    const bIsKeloid = (b.disease || '').toLowerCase() === 'keloid'
    if (aIsKeloid && !bIsKeloid) return -1
    if (!aIsKeloid && bIsKeloid) return 1
    return navLabel(a.disease).localeCompare(navLabel(b.disease))
  })
}

function NavIcon({ tone }) {
  const svg = {
    className: 'disease-nav-svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  switch (tone) {
    case 'cardiac':
      return (
        <svg {...svg}>
          <path
            d="M12 21s-7-4.6-9-9.2C1.5 9.5 3.8 6 7.2 6c1.6 0 2.9.9 4.8 3.1C13.9 6.9 15.2 6 16.8 6 20.2 6 22.5 9.5 21 11.8 19 16.4 12 21 12 21z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      )
    case 'keloid':
      return (
        <svg {...svg}>
          <rect x="6" y="7" width="12" height="10" rx="2.5" />
          <path d="M9 11h6M9 14h6" />
        </svg>
      )
    case 'kidney':
      return (
        <svg {...svg}>
          <path d="M14.5 5.5c2.8 0 4.5 2.8 4.5 6.5s-1.7 6.5-4.5 6.5c-1.4 0-2.4-1-3.5-2.4C10.4 17.5 9.4 18.5 8 18.5c-2.8 0-4.5-2.8-4.5-6.5S5.2 5.5 8 5.5c1.4 0 2.4 1 3.5 2.4 1.1-1.4 2.1-2.4 3-2.4z" />
        </svg>
      )
    case 'liver':
      return (
        <svg {...svg}>
          <path d="M6.5 9.5c0-2.5 2.2-4.5 5-4.5 1.2 0 2.2.4 3 1.1.8-.7 1.8-1.1 3-1.1 2.8 0 5 2 5 4.5 1.2 0 2 1 2 2.5 0 2.8-2.4 5-5.5 5.5-2.3.4-4.6-.6-6.2-2.3-1.6 1.7-3.9 2.7-6.2 2.3C4.9 17 2.5 14.8 2.5 12c0-1.5.8-2.5 2-2.5 0-2.5 1.8-4.5 4-4.5 1 0 1.8.4 2.5 1 0-1.2 1.2-2 2.5-2 1.4 0 2.5 1 2.5 2.2 0 .5-.1 1-.3 1.3z" />
        </svg>
      )
    case 'pulmonary':
      return (
        <svg {...svg} stroke="none">
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="7.6" r="2.7" fill="currentColor" />
          <circle cx="15.9" cy="10.4" r="2.7" fill="currentColor" />
          <circle cx="14.4" cy="14.8" r="2.7" fill="currentColor" />
          <circle cx="9.6" cy="14.8" r="2.7" fill="currentColor" />
          <circle cx="8.1" cy="10.4" r="2.7" fill="currentColor" />
        </svg>
      )
    default:
      return (
        <svg {...svg}>
          <circle cx="12" cy="12" r="6.5" />
          <path d="M12 9v6M9 12h6" />
        </svg>
      )
  }
}

export default function DiseaseNav({ diseases, activeKey, setActiveKey }) {
  const sortedDiseases = sortDiseases(diseases)

  return (
    <nav className="disease-nav" aria-label="Fibrosis types">
      <div className="disease-nav-brand">
        <img src={LOGO_URL} alt="RADAR-Scout" className="disease-nav-logo-img" width={42} height={42} />
      </div>

      <div className="disease-nav-list">
        {sortedDiseases.map((d) => {
          const active = d.key === activeKey
          const tone = navTone(d.disease)
          const label = navLabel(d.disease)
          return (
            <button
              key={d.key}
              type="button"
              className={`disease-nav-btn${active ? ' active' : ''}`}
              onClick={() => setActiveKey(d.key)}
              aria-current={active ? 'page' : undefined}
              aria-label={`${label}, ${d.n_cohorts} cohort${d.n_cohorts !== 1 ? 's' : ''}`}
              title={`${label} · ${d.n_cohorts} cohort${d.n_cohorts !== 1 ? 's' : ''}`}
            >
              <span className={`disease-nav-icon tone-${tone}`}>
                <NavIcon tone={tone} />
              </span>
              <span className="disease-nav-btn-label">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
