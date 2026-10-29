import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage, fetchResource } from './api';
import { usesTeamsSession } from './teamsSession';

type ImageProps = { src: string; alt: string; onError: () => void };
function TeamsImage({ src, alt, onError }: ImageProps) {
  const [image, setImage] = useState<{ source: string; url: string } | null>(null);
  const reportError = useRef(onError);
  reportError.current = onError;
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    void (async () => {
      try {
        const response = await fetchResource(src, abort.signal);
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ source: src, url });
      } catch (error) {
        if (!abort.signal.aborted) {
          console.warn('Unable to load an authenticated Learning image.', error);
          reportError.current();
        }
      }
    })();
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [src]);
  return image?.source === src ? <img src={image.url} alt={alt} onError={onError} /> : <span role="status">Loading image...</span>;
}
export function AuthenticatedImage(props: ImageProps) {
  return usesTeamsSession() ? <TeamsImage {...props} /> : <img {...props} />;
}

export async function downloadResource(href: string, fileName: string) {
  const response = await fetchResource(href);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  try { document.body.appendChild(link); link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
type LinkProps = { href: string; fileName: string; className?: string; children: ReactNode };
function TeamsResourceLink({ href, fileName, className, children }: LinkProps) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <><a className={className} href={href} aria-busy={busy} onClick={(event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    void downloadResource(href, fileName).catch((error) => setError(errorMessage(error))).finally(() => setBusy(false));
  }}>{children}</a>{error && <span role="alert">{error}</span>}</>;
}
export function ResourceLink({ href, className, children, ...props }: LinkProps) {
  return usesTeamsSession() ? <TeamsResourceLink href={href} className={className} {...props}>{children}</TeamsResourceLink>
    : <a className={className} href={href}>{children}</a>;
}
