import { useEffect, useRef, useState } from 'react'
import { closeAbout } from './about-store.ts'
import {
  CONTACT_EMAIL,
  CONTACT_HEADING,
  CONTACT_INCLUDE,
  CONTACT_INTRO,
  contactLink,
  LEGAL_SECTIONS,
  YOUTUBE_COPYRIGHT,
  type LegalPart,
} from './legal-text.ts'

function Part({ part }: { part: LegalPart }) {
  if (typeof part === 'string') return <>{part}</>
  return (
    <a href={part.href} target="_blank" rel="noopener noreferrer">
      {part.text}
    </a>
  )
}

export function RightsContact() {
  const mail = contactLink('TVN rights & attribution')
  return (
    <div id="about-contact" className="about-contact">
      <p className="about-contact-head">{CONTACT_HEADING}</p>
      <p>{CONTACT_INTRO}</p>
      {CONTACT_EMAIL && mail ? (
        <p>
          <a href={mail}>{CONTACT_EMAIL}</a>
        </p>
      ) : null}
      <p>{CONTACT_INCLUDE}</p>
    </div>
  )
}

/**
 * The rights and attribution route, collapsed until the viewer opens it: the address is only rendered
 * then, as plain text, so it reads as a route for creators and rights holders rather than general contact.
 */
export function FeedbackRoute() {
  const [open, setOpen] = useState(false)
  return (
    <div className="about-feedback">
      <button type="button" className="about-disclose" aria-expanded={open} aria-controls="about-contact" onClick={() => setOpen((shown) => !shown)}>
        Contact TVN
      </button>
      {open ? <RightsContact /> : null}
      <a className="about-button" href={YOUTUBE_COPYRIGHT} target="_blank" rel="noopener noreferrer">
        YouTube copyright tools
      </a>
    </div>
  )
}

/** About · Sources · Legal: reached from TVN settings, the credits and the first-run notice. */
export function AboutPanel() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="about-scrim" onClick={(event) => event.target === event.currentTarget && closeAbout()}>
      <section
        className="about-panel"
        role="dialog"
        aria-modal="true"
        aria-label="About, sources and legal"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') closeAbout()
        }}
      >
        <header className="about-head">
          <p>About · Sources · Legal</p>
          <button type="button" className="remote-close" onClick={closeAbout}>
            Close
          </button>
        </header>
        <nav className="about-nav" aria-label="Sections">
          {LEGAL_SECTIONS.map((section) => (
            <a key={section.id} href={`#about-${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>
        {LEGAL_SECTIONS.map((section) => (
          <article key={section.id} id={`about-${section.id}`} className="about-section">
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index}>
                {paragraph.map((part, at) => (
                  <Part key={at} part={part} />
                ))}
              </p>
            ))}
            {section.id === 'rights' ? <FeedbackRoute /> : null}
          </article>
        ))}
      </section>
    </div>
  )
}
