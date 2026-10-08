import { Message } from '../lib/api';
import { attachmentName, fileIcon, formatSize, mediaKind } from '../lib/files';
import { useStore } from '../lib/store';

interface Props {
  msg: Message;
  onImage: (src: string) => void;
  onMediaLoad: () => void;
}

/** Вложение сообщения: картинка, проигрыватель видео/звука или карточка файла; у своего неотправленного — прогресс загрузки */
export function Attachment({ msg, onImage, onMediaLoad }: Props) {
  const discardSend = useStore((s) => s.discardSend);
  if (!msg.attachment) return null;
  // Старый сервер не сообщает тип — вложением у него могла быть только картинка
  const image = msg.attachment_type !== 'file';
  const name = attachmentName(msg.attachment_name, msg.attachment);
  const uploading = msg.local === 'sending' && msg.progress !== undefined && msg.nonce;
  const progress = uploading ? (
    <div className="upload-progress">
      <div
        className="upload-bar"
        role="progressbar"
        aria-label={`Загрузка «${name}»`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((msg.progress ?? 0) * 100)}
      >
        <span style={{ width: `${Math.round((msg.progress ?? 0) * 100)}%` }} />
      </div>
      <span className="muted small">{Math.round((msg.progress ?? 0) * 100)}%</span>
      <button className="link-btn small" onClick={() => discardSend(msg.nonce!)}>
        Отменить
      </button>
    </div>
  ) : null;

  if (image)
    return (
      <>
        <button className="plain attachment" onClick={() => onImage(msg.attachment)} aria-label="Открыть изображение">
          <img src={msg.attachment} alt={name} onLoad={onMediaLoad} />
        </button>
        {progress}
      </>
    );

  // Плеер — только для уже загруженного на сервер файла
  const media = msg.local ? null : mediaKind(name);
  const size = formatSize(msg.attachment_size ?? 0);
  return (
    <div className={`attachment-file${media ? ` with-${media}` : ''}`}>
      {media === 'video' && (
        <video className="attachment-video" src={msg.attachment} controls preload="metadata" onLoadedMetadata={onMediaLoad} />
      )}
      <div className="file-card">
        <span className="file-icon" aria-hidden="true">
          {fileIcon(name)}
        </span>
        <div className="file-info">
          {msg.local ? (
            <span className="file-name ellipsis">{name}</span>
          ) : (
            <a className="file-name ellipsis" href={msg.attachment} download={name} title={name}>
              {name}
            </a>
          )}
          {size && <span className="muted small">{size}</span>}
        </div>
        {!msg.local && (
          <a className="icon-btn" href={msg.attachment} download={name} title="Скачать" aria-label={`Скачать «${name}»`}>
            ⬇
          </a>
        )}
      </div>
      {media === 'audio' && <audio className="attachment-audio" src={msg.attachment} controls preload="metadata" />}
      {progress}
    </div>
  );
}
