import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { PredictionState } from '@shared/types';
import { HollrService } from '../core/hollr.service';

@Component({
  selector: 'hl-prediction-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (prediction(); as p) {
      <div class="card stack">
        <div class="spread">
          <div>
            <h3>Prediction · {{ p.status === 'LOCKED' ? 'locked' : 'open' }}</h3>
            <h2>{{ p.title }}</h2>
          </div>
          <div class="muted">
            @if (p.status === 'ACTIVE' && secondsLeft() !== null) {
              {{ secondsLeft() }}s to predict ·
            }
            {{ totalPoints() | number }} pts
          </div>
        </div>
        @for (o of p.outcomes; track o.id) {
          <div class="bar">
            <div class="fill" [style.width.%]="pct(o.channelPoints)" [style.background]="color(o.color)"></div>
            <span>{{ o.title }}</span>
            <span class="row">
              {{ o.users }} users · {{ pct(o.channelPoints) }}%
              <button class="btn small" (click)="resolve(o.id, o.title)">Winner</button>
            </span>
          </div>
        }
        <div class="row">
          @if (p.status === 'ACTIVE') {
            <button class="btn" (click)="hollr.execute({ kind: 'prediction.lock' })">Lock</button>
          }
          <button class="btn danger" (click)="hollr.execute({ kind: 'prediction.cancel' })">Cancel &amp; refund</button>
        </div>
      </div>
    }
  `,
  styles: `
    .bar { position: relative; display: flex; justify-content: space-between; align-items: center; padding: 6px 8px 6px 12px;
           border-radius: 8px; background: var(--panel-2); overflow: hidden; font-weight: 600; }
    .bar > span { position: relative; }
    .fill { position: absolute; inset: 0 auto 0 0; opacity: .45; transition: width .4s ease; }
  `,
  imports: [DecimalPipe],
})
export class PredictionCardComponent {
  readonly hollr = inject(HollrService);
  readonly prediction = input<PredictionState | null>(null);

  readonly totalPoints = computed(() => this.prediction()?.outcomes.reduce((n, o) => n + o.channelPoints, 0) ?? 0);
  readonly secondsLeft = computed(() => {
    const at = this.prediction()?.locksAt;
    return at ? Math.max(0, Math.round((Date.parse(at) - this.hollr.now()) / 1000)) : null;
  });

  pct(points: number): number {
    const t = this.totalPoints();
    return t ? Math.round((points / t) * 100) : 0;
  }

  color(c: string): string {
    return c === 'PINK' ? 'var(--pink)' : 'var(--blue)';
  }

  resolve(outcomeId: string, outcome: string): void {
    if (confirm(`Resolve the prediction with "${outcome}" as the winner?`)) {
      void this.hollr.execute({ kind: 'prediction.resolve', outcome, outcomeId });
    }
  }
}
