import { useState, type ComponentType } from 'react'
import { NewsPanel } from './info/NewsPanel.tsx'
import { keepKey } from './keep-key.ts'

export type InfoModuleId = 'news' | 'sports'

export interface InfoModule {
  id: InfoModuleId
  label: string
  Panel: ComponentType
}

/**
 * Modules that are ready to show. News is live; Sports follows when its snapshot is wired.
 * INFO still opens as a Guide panel over the picture when the list is empty.
 */
export const INFO_MODULES: readonly InfoModule[] = [{ id: 'news', label: 'News', Panel: NewsPanel }]

/**
 * INFO: news and sports in the Guide, over the picture. Opening it does not retune or remount the player.
 * Tool id is `infocentre` so it never collides with the picture information bar (`info` / V).
 */
export function InfoCentre() {
  const modules = INFO_MODULES
  const [moduleId, setModuleId] = useState<InfoModuleId | null>(() => modules[0]?.id ?? null)
  const active = modules.find((module) => module.id === moduleId) ?? modules[0] ?? null
  const Panel = active?.Panel

  return (
    <div className="guide-options info-centre" role="region" aria-label="Info centre">
      <div className="info-centre-head">
        <h3 className="options-head">Info</h3>
        {modules.length > 0 ? (
          <div className="tabs" role="tablist" aria-label="Info sections">
            {modules.map((module) => (
              <button
                key={module.id}
                type="button"
                role="tab"
                aria-selected={active?.id === module.id}
                className={active?.id === module.id ? 'tab is-on' : 'tab'}
                onKeyDown={keepKey}
                onClick={() => setModuleId(module.id)}
              >
                {module.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {Panel ? (
        <div className="info-centre-body" role="tabpanel" aria-label={active?.label}>
          <Panel />
        </div>
      ) : (
        <p className="options-note">News and Sports open here when their information is ready.</p>
      )}
    </div>
  )
}
