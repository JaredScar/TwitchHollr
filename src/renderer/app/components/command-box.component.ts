import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HollrService } from '../core/hollr.service';

@Component({
  selector: 'hl-command-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <form class="row" (ngSubmit)="submit()">
      <input
        type="text"
        name="command"
        data-testid="command-input"
        [placeholder]="'Type a command, e.g. ' + wakeWord() + ' poll win or loss for 2 minutes'"
        [ngModel]="text()"
        (ngModelChange)="text.set($event)"
        autocomplete="off"
      />
      <button class="btn primary" type="submit" [disabled]="!text().trim()">Run</button>
    </form>
  `,
  styles: `
    form { flex-wrap: nowrap; padding: 6px; border-radius: 14px; background: rgba(255,255,255,.04); border: 1px solid var(--border);
           box-shadow: var(--shadow); transition: border-color .15s, box-shadow .15s; gap: 8px; }
    form:focus-within { border-color: var(--accent); box-shadow: var(--ring); }
    input { flex: 1; background: transparent !important; border: 0 !important; box-shadow: none !important; padding: 10px 12px; font-size: 14.5px; }
    .btn { padding: 10px 22px; }
  `,
})
export class CommandBoxComponent {
  private readonly hollr = inject(HollrService);
  readonly wakeWord = input('hollr');
  readonly text = signal('');

  async submit(): Promise<void> {
    const t = this.text().trim();
    if (!t) return;
    this.text.set('');
    await this.hollr.run(t);
  }
}
