import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { PollState } from '@shared/types';
import { HollrService } from '../core/hollr.service';

@Component({
  selector: 'hl-poll-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (poll(); as p) {
      <div class="card stack">
        <div class="spread">
          <div>
            <h3>{{ p.status === 'ACTIVE' ? 'Active poll' : 'Last poll · ' + p.status.toLowerCase() }}</h3>
            <h2>{{ p.title }}</h2>
          </div>
          <div class="muted">
            @if (p.status === 'ACTIVE' && secondsLeft() !== null) {
              {{ secondsLeft() }}s left ·
            }
            {{ total() }} votes
          </div>
        </div>
        @for (c of p.choices; track c.id) {
          <div class="bar" [class.winner]="p.status !== 'ACTIVE' && c.id === leaderId()">
            <div class="fill" [style.width.%]="pct(c.votes)"></div>
            <span>{{ c.title }}</span>
            <span>{{ c.votes }} · {{ pct(c.votes) }}%</span>
          </div>
        }
        @if (p.status === 'ACTIVE') {
          <div class="row">
            <button class="btn" (click)="hollr.execute({ kind: 'poll.end' })">End poll</button>
            <button class="btn danger" (click)="hollr.execute({ kind: 'poll.cancel' })">Cancel &amp; hide</button>
          </div>
        } @else {
          <div class="row">
            <button class="btn" (click)="hollr.execute({ kind: 'poll.repeat' })">Repeat poll</button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .bar { position: relative; display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-radius: 12px;
           background: rgba(0, 0, 0, 0.28); border: 1px solid var(--border); overflow: hidden; font-weight: 600; }
    .bar span { position: relative; }
    .bar span:last-child { color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 500; }
    .fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, rgba(145, 71, 255, 0.55), rgba(145, 71, 255, 0.28));
            transition: width .6s cubic-bezier(.2,.8,.2,1); border-right: 1px solid rgba(183, 148, 255, 0.6); }
    .winner { border-color: rgba(52, 211, 153, 0.5); }
    .winner .fill { background: linear-gradient(90deg, rgba(52, 211, 153, 0.5), rgba(52, 211, 153, 0.22)); border-right-color: rgba(52, 211, 153, 0.7); }
  `,
})
export class PollCardComponent {
  readonly hollr = inject(HollrService);
  readonly poll = input<PollState | null>(null);

  readonly total = computed(() => this.poll()?.choices.reduce((n, c) => n + c.votes, 0) ?? 0);
  readonly leaderId = computed(() => {
    const choices = this.poll()?.choices ?? [];
    return [...choices].sort((a, b) => b.votes - a.votes)[0]?.id ?? null;
  });
  readonly secondsLeft = computed(() => {
    const end = this.poll()?.endsAt;
    return end ? Math.max(0, Math.round((Date.parse(end) - this.hollr.now()) / 1000)) : null;
  });

  pct(votes: number): number {
    const t = this.total();
    return t ? Math.round((votes / t) * 100) : 0;
  }
}
