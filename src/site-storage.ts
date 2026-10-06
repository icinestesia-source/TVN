import { EMPTY_SITE, EMPTY_SITE_WELCOMED, installSiteStorage } from './app/site.ts'
import { acknowledgeNotice } from './legal/about-store.ts'

installSiteStorage()
if (EMPTY_SITE && location.hash === EMPTY_SITE_WELCOMED) {
  acknowledgeNotice()
  history.replaceState(history.state, '', location.pathname + location.search)
}
