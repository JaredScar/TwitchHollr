import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MicCaptureService } from '../audio/mic-capture.service';
import { HollrService } from '../core/hollr.service';
import { LevelMeterComponent } from './level-meter.component';

@Component({
  selector: 'hl-mic-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LevelMeterComponent],
  template: `
    <div class="stack">
      <label class="field">
        Microphone
        <select [value]="selectedId()" (change)="pick($any($event.target).value)">
          @for (d of mic.devices(); track d.deviceId) {
            <option [value]="d.deviceId">{{ d.label }}</option>
          }
        </select>
      </label>
      <hl-level-meter [level]="mic.level()" [live]="mic.running()" />
      @if (mic.error()) {
        <div class="banner error">
          {{ mic.error() }}
          <button class="btn small" (click)="mic.restart()">Retry</button>
        </div>
      } @else {
        <div class="muted">Talk normally: the bar should move. Only this microphone is ever listened to.</div>
      }
    </div>
  `,
})
export class MicPickerComponent {
  readonly mic = inject(MicCaptureService);
  private readonly hollr = inject(HollrService);

  readonly selectedId = computed(() => {
    const pref = this.hollr.settings()?.mic;
    const devices = this.mic.devices();
    return (
      devices.find((d) => d.deviceId === pref?.deviceId)?.deviceId ??
      devices.find((d) => d.label === pref?.label)?.deviceId ??
      devices[0]?.deviceId ??
      ''
    );
  });

  constructor() {
    void this.mic.refreshDevices();
  }

  pick(deviceId: string): void {
    const d = this.mic.devices().find((x) => x.deviceId === deviceId);
    void this.hollr.update({ mic: { deviceId, label: d?.label ?? null } });
  }
}
