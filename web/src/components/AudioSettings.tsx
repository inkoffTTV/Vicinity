import { useEffect, useState } from 'react';
import { canPickOutput, useMediaPrefs } from '../lib/media';
import { Modal } from './Modal';

// Устройства ввода/вывода и уровни — общие для голосовых каналов и звонков.
// Усиление микрофона действует только в голосовых каналах (там звук проходит через наш обработчик).
export function AudioSettings({ onClose, micGain = true }: { onClose: () => void; micGain?: boolean }) {
  const prefs = useMediaPrefs();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const load = () => md.enumerateDevices().then(setDevices, () => {});
    void load();
    md.addEventListener('devicechange', load);
    return () => md.removeEventListener('devicechange', load);
  }, []);

  // «default» — то же, что пустой выбор («по умолчанию»)
  const list = (kind: MediaDeviceKind) =>
    devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default');
  const inputs = list('audioinput');
  const outputs = list('audiooutput');

  return (
    <Modal title="Голос и звук" onClose={onClose}>
      <div className="stack audio-settings">
        <label>
          Микрофон
          <select value={prefs.inputId} onChange={(e) => prefs.set({ inputId: e.target.value })}>
            <option value="">По умолчанию</option>
            {inputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Микрофон ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        {canPickOutput && (
          <label>
            Динамики
            <select value={prefs.outputId} onChange={(e) => prefs.set({ outputId: e.target.value })}>
              <option value="">По умолчанию</option>
              {outputs.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Устройство вывода ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
        {micGain && (
          <label>
            <span className="row-between">
              Усиление микрофона <span className="muted small">{Math.round(prefs.micGain * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(prefs.micGain * 100)}
              onChange={(e) => prefs.set({ micGain: Number(e.target.value) / 100 })}
            />
          </label>
        )}
        <label>
          <span className="row-between">
            Громкость собеседников <span className="muted small">{Math.round(prefs.volume * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={Math.round(prefs.volume * 100)}
            onChange={(e) => prefs.set({ volume: Number(e.target.value) / 100 })}
          />
        </label>
        {!canPickOutput && (
          <div className="muted small">Этот браузер не позволяет выбрать устройство вывода звука.</div>
        )}
      </div>
    </Modal>
  );
}
