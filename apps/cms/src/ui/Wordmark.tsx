import { t } from '@/i18n/is';

const [NAME, ...REST] = t.app.title.split(' ');

/** The Litljómi cloud, from the design system's mark: the path is copied, never redrawn. */
export function Cloud({ className = 'cloud' }: { className?: string }) {
  return (
    <svg className={className} viewBox="56 134 400 246" aria-hidden="true">
      <g transform="translate(60.0,360.8) scale(0.3176)">
        <path d="M791.9 -654.5C689.4 -654.5 595.2 -598.1 546.7 -507.8C512.4 -533.7 470.6 -547.7 427.6 -547.8C318.2 -547.8 229.5 -459.1 229.5 -349.7C229.6 -347.7 229.7 -345.6 229.8 -343.5C224.8 -344.0 219.9 -344.2 214.9 -344.3C121.3 -344.3 45.5 -268.4 45.5 -174.9C45.5 -81.3 121.3 -5.5 214.9 -5.5H1019.3C1112.8 -5.5 1188.7 -81.3 1188.7 -174.9C1188.6 -249.8 1139.3 -315.9 1067.4 -337.2C1069.3 -350.0 1070.4 -363.0 1070.5 -376.0C1070.5 -529.8 945.8 -654.5 791.9 -654.5L791.9 -654.5Z" />
      </g>
    </svg>
  );
}

/** "Litljómi vefumsjón": the mark and the name. */
export function Wordmark() {
  return (
    <span className="wm">
      <Cloud />
      <span>{NAME}</span>
      <span className="wm-sub">{REST.join(' ')}</span>
    </span>
  );
}
