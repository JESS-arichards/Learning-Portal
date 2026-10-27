import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Copy, Info } from 'lucide-react';
import { supportReport, type SupportSession } from './supportInfo';
import { Modal } from './Modal';
import './support.css';

export function SupportInfoButton({ session }: { session: SupportSession | null }) {
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;

  const open = () => {
    setCopied(false);
    setError(null);
    setReport(supportReport(session, {
      origin: window.location.origin,
      appLocation: window.location.pathname,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      installed: window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true),
      capturedAt: new Date().toISOString(),
    }));
  };

  const copy = async () => {
    if (!report) return;
    setCopied(false);
    setError(null);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setError('Unable to copy automatically. Select the support details below and copy them manually.');
    }
  };

  return (
    <>
      <button type="button" className="jess-nav-icon portal-support-trigger icon-btn" aria-label="Build and support information" title="Build and support information" onClick={open}>
        <Info size={20} aria-hidden="true" />
      </button>
      {report && createPortal(
        <Modal title="Build and support information" className="portal-support-dialog" onClose={() => setReport(null)}>
          <p>This identifies the build currently loaded on your device, which may differ from the latest deployment. Browser and OS details are reported by your browser and may be approximate.</p>
          <p>Contains your name, email and roles. Share only with trusted support staff. No passwords, authentication tokens or cookies are included.</p>
          {error && <div className="portal-support-alert error" role="alert"><AlertCircle size={18} /><div>{error}</div></div>}
          {copied && <div className="portal-support-alert success" role="status"><CheckCircle2 size={18} /><div>Support details copied.</div></div>}
          <div className="field">
            <label htmlFor="support-details">Support details</label>
            <textarea id="support-details" className="input support-details" readOnly rows={18} value={report} spellCheck={false} />
          </div>
          <button type="button" className="portal-support-copy" onClick={() => void copy()}><Copy size={18} aria-hidden="true" /> Copy details</button>
        </Modal>,
        document.body,
      )}
    </>
  );
}
