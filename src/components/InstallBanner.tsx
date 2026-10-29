import { useEffect, useState } from 'react';
import { canPrompt, dismissInstall, installDismissed, isAndroid, isInstalled, isIOS, onInstallChange, promptInstall } from '../lib/install';

// Share icon as Safari draws it, so the steps match what the user sees.
const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M8 7l4-4 4 4M5 11v9h14v-9" />
  </svg>
);

/** Invites a browser user to add the app to the home screen. Hidden once installed, or for a month after closing it. */
export function InstallBanner() {
  const [, rerender] = useState(0);
  const [hidden, setHidden] = useState(() => isInstalled() || installDismissed());
  useEffect(() => onInstallChange(() => rerender((x) => x + 1)), []);

  const ios = isIOS();
  const prompt = canPrompt();
  if (hidden || isInstalled() || !(ios || prompt || isAndroid())) return null;

  const close = () => { dismissInstall(); setHidden(true); };
  const install = async () => { if (await promptInstall()) setHidden(true); };

  return (
    <aside className="install-banner" aria-label="התקנת האפליקציה">
      <button type="button" className="close" aria-label="סגירה" onClick={close}>×</button>
      <strong>📲 התקינו את Next Team על מסך הבית</strong>
      {prompt ? (
        <>
          <p>האפליקציה תיפתח במסך מלא, בלחיצה אחת מהאייקון.</p>
          <button type="button" onClick={install}>התקנה</button>
        </>
      ) : ios ? (
        <>
          <p>כך תיפתח במסך מלא, ותוכלו לקבל התראות לטלפון.</p>
          <ol>
            <li>לוחצים על כפתור השיתוף <ShareIcon /> בתחתית Safari</li>
            <li>בוחרים <b>"הוספה למסך הבית"</b></li>
            <li>לוחצים <b>"הוסף"</b></li>
          </ol>
        </>
      ) : (
        <>
          <p>כך תיפתח במסך מלא, בלחיצה אחת מהאייקון.</p>
          <ol>
            <li>לוחצים על התפריט <b>⋮</b> בדפדפן</li>
            <li>בוחרים <b>"התקנת האפליקציה"</b> או <b>"הוספה למסך הבית"</b></li>
          </ol>
        </>
      )}
    </aside>
  );
}
