import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type ElementRef, effect, input, viewChild } from '@angular/core';
import type { LogEntry } from '@shared/types';

const ICON: Record<LogEntry['stage'], string> = { heard: '👂', parsed: '🧩', result: '⚡', system: '•' };

@Component({
  selector: 'hl-activity-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="log" #scroller data-testid="activity-log">
      @for (e of entries(); track e.id) {
        <div class="entry" [class]="e.level">
          <span class="time">{{ e.ts | date: 'HH:mm:ss' }}</span>
          <span class="src">{{ icon(e) }} {{ e.source }}</span>
          <span class="msg">{{ e.message }}</span>
        </div>
      } @empty {
        <div class="muted">Nothing yet. Say "{{ wakeWord() }}, poll yes or no" or type a command above.</div>
      }
    </div>
  `,
  styles: `
    .log { height: 100%; overflow-y: auto; font-size: 13px; display: flex; flex-direction: column; gap: 1px; padding-right: 4px; }
    .entry { display: grid; grid-template-columns: 66px 96px 1fr; gap: 10px; padding: 6px 10px; border-radius: 8px; align-items: baseline; }
    .entry:hover { background: var(--panel-2); }
    .time { color: var(--faint); font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; font-variant-numeric: tabular-nums; }
    .src { color: var(--muted); white-space: nowrap; font-size: 12px; }
    .msg { overflow-wrap: anywhere; }
    .success .msg { color: var(--green); }
    .warn .msg { color: var(--amber); }
    .error .msg { color: var(--red); }
  `,
})
export class ActivityLogComponent {
  readonly entries = input<LogEntry[]>([]);
  readonly wakeWord = input('hollr');
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  constructor() {
    effect(() => {
      this.entries();
      const el = this.scroller()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
  }

  icon(e: LogEntry): string {
    return ICON[e.stage];
  }
}
