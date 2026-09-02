import { createApp } from 'vue'
import './semantic-tokens.css'
import { applyThemeManifest, CAIRN_THEME_MANIFEST } from './semantic-tokens'
import {
  RENDERER_FAILURE_EVENT,
  rendererFailureReport,
  resetUiPreferences,
  type RendererFailureReport
} from './renderer-recovery'
import { canonicalPreferenceCandidate, PREFERENCE_STORAGE_KEY } from './preference-repository'
import './styles.css'

applyThemeManifest(document.documentElement, CAIRN_THEME_MANIFEST)

let rootRecoveryVisible = false

function renderRootRecovery(error: unknown, existingFailure?: RendererFailureReport): void {
  if (rootRecoveryVisible) return
  rootRecoveryVisible = true
  const failure = existingFailure ?? rendererFailureReport(error, 'application shell')
  void window.cairnCodex.reportRendererError(failure).catch(() => undefined)
  const host = document.querySelector<HTMLElement>('#app')
  if (!host) return
  const recovery = document.createElement('main')
  recovery.className = 'root-recovery'
  recovery.setAttribute('role', 'alert')
  recovery.innerHTML = `
    <section>
      <p class="section-label">CC recovery</p>
      <h1>The interface could not start.</h1>
      <p class="root-recovery-message"></p>
      <p>Your archive and Grim Dawn files were not changed.</p>
      <dl>
        <div><dt>Correlation ID</dt><dd><code class="root-recovery-correlation"></code></dd></div>
      </dl>
      <div class="root-recovery-actions">
        <button type="button" data-action="reload">Try again</button>
        <button type="button" data-action="safe">Restart in safe mode</button>
        <button type="button" data-action="reset">Reset UI preferences</button>
        <button type="button" data-action="diagnostics">Export diagnostics</button>
      </div>
      <small>Reset UI preferences does not delete the Codex Archive, planner profiles, to-dos, saves, stashes, or backups.</small>
    </section>`
  recovery.querySelector<HTMLElement>('.root-recovery-message')!.textContent = failure.message
  recovery.querySelector<HTMLElement>('.root-recovery-correlation')!.textContent = failure.correlationId
  recovery.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action
    if (action === 'reload') location.reload()
    if (action === 'safe') void window.cairnCodex.restartInSafeMode()
    if (action === 'reset') {
      resetUiPreferences(localStorage)
      const serialized = localStorage.getItem(PREFERENCE_STORAGE_KEY)
      void (serialized ? window.cairnCodex.savePreferences(serialized) : Promise.resolve())
        .finally(() => location.reload())
    }
    if (action === 'diagnostics') void window.cairnCodex.exportDiagnostics()
  })
  host.replaceChildren(recovery)
  recovery.querySelector<HTMLButtonElement>('[data-action="reload"]')?.focus()
}

async function bootstrap(): Promise<void> {
  const origin = location.protocol === 'file:' ? 'file://' : location.origin
  const candidate = canonicalPreferenceCandidate(localStorage)
  const durable = await window.cairnCodex.loadPreferences(
    origin,
    candidate
  )
  if (durable.serialized !== null) localStorage.setItem(PREFERENCE_STORAGE_KEY, durable.serialized)
  const { default: App } = await import('./App.vue')
  const app = createApp(App)
  app.config.errorHandler = (error) => {
    const failure = rendererFailureReport(error, 'active workspace')
    const handled = !window.dispatchEvent(new CustomEvent(RENDERER_FAILURE_EVENT, {
      detail: failure,
      cancelable: true
    }))
    if (!handled) renderRootRecovery(error, failure)
  }
  app.mount('#app')
}

void bootstrap().catch((error) => renderRootRecovery(error))
