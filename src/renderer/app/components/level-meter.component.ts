import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'hl-level-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="meter" [class.live]="live()" title="Microphone input level">
    <div class="fill" [style.width.%]="level() * 100"></div>
  </div>`,
  styles: `
    .meter { height: 10px; border-radius: 999px; background: var(--panel-2); overflow: hidden; border: 1px solid var(--border); }
    .fill { height: 100%; background: var(--muted); transition: width 60ms linear; }
    .live .fill { background: linear-gradient(90deg, var(--green), var(--amber) 80%, var(--red)); }
  `,
})
export class LevelMeterComponent {
  readonly level = input(0);
  readonly live = input(false);
}
