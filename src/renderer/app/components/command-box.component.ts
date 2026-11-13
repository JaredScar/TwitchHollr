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
    form { flex-wrap: nowrap; }
    input { flex: 1; }
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
