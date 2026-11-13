import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HollrService } from '../core/hollr.service';

const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;

@Component({
  selector: 'hl-model-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @for (m of models(); track m.id) {
        <div class="spread model" [class.current]="m.id === currentId()">
          <div>
            <strong>{{ m.label }}</strong>
            <div class="muted">
              {{ size(m.sizeBytes) }} · {{ m.installed ? 'installed' : 'not downloaded' }}
              @if (m.id === currentId()) {
                · selected engine
              }
            </div>
          </div>
          @if (download()?.modelId === m.id) {
            <div class="progress">
              <div class="fill" [style.width.%]="percent()"></div>
              <span>{{ percent() }}%</span>
            </div>
          } @else if (!m.installed) {
            <button class="btn" [class.primary]="m.id === currentId()" [disabled]="!!download()" (click)="get(m.id)">
              Download
            </button>
          } @else {
            <span class="chip ok">Ready</span>
          }
        </div>
      }
      @if (error()) {
        <div class="banner error">{{ error() }}</div>
      }
      <div class="muted">Models are verified by SHA-256 and stored on this PC. Speech never leaves your computer.</div>
    </div>
  `,
  styles: `
    .model { padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
    .model.current { border-color: var(--accent); }
    .progress { position: relative; width: 160px; height: 22px; border-radius: 6px; background: var(--panel-2); overflow: hidden; }
    .progress .fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); transition: width .2s; }
    .progress span { position: relative; display: block; text-align: center; font-size: 12px; font-weight: 700; line-height: 22px; }
  `,
})
export class ModelPanelComponent {
  private readonly hollr = inject(HollrService);
  readonly error = signal<string | null>(null);
  readonly models = computed(() => this.hollr.state()?.models ?? []);
  readonly download = computed(() => this.hollr.state()?.download ?? null);
  readonly percent = computed(() => {
    const d = this.download();
    return d && d.totalBytes ? Math.floor((d.receivedBytes / d.totalBytes) * 100) : 0;
  });
  readonly currentId = computed(() => {
    const s = this.hollr.settings()?.stt;
    if (!s) return '';
    return s.engine === 'sherpa' ? 'zipformer-en-2023-06-26' : `whisper-${s.whisperModel}`;
  });

  size(b: number): string {
    return mb(b);
  }

  async get(id: string): Promise<void> {
    this.error.set(null);
    try {
      await this.hollr.api.downloadModel(id);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': /, '') : String(err));
    }
  }
}
