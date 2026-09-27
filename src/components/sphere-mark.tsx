import { useId } from "react";

export function SphereMark({ className = "", label }: { className?: string; label?: string }) {
  const id = useId().replaceAll(":", "");
  const gradientId = `sphere-core-${id}`;
  const exoticYellowId = `sphere-exotic-yellow-${id}`;
  const exoticPinkId = `sphere-exotic-pink-${id}`;
  const exoticPurpleId = `sphere-exotic-purple-${id}`;
  const exoticBlueId = `sphere-exotic-blue-${id}`;
  const ultimatePinkId = `sphere-ultimate-pink-${id}`;
  const ultimateBlueId = `sphere-ultimate-blue-${id}`;
  return <svg className={`sphere-mark ${className}`} viewBox="0 0 512 512" aria-hidden="true">
    <defs>
      <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0"><stop offset="0" className="sphere-core-start" /><stop offset=".5" className="sphere-core-middle" /><stop offset="1" className="sphere-core-end" /></linearGradient>
      <radialGradient id={exoticYellowId} cx="72%" cy="3%" r="82%"><stop offset="0" stopColor="#edff35" /><stop offset=".58" stopColor="#edff35" stopOpacity=".88" /><stop offset="1" stopColor="#edff35" stopOpacity="0" /></radialGradient>
      <radialGradient id={exoticPinkId} cx="105%" cy="42%" r="72%"><stop offset="0" stopColor="#ff42c7" /><stop offset=".52" stopColor="#f677b8" stopOpacity=".9" /><stop offset="1" stopColor="#f677b8" stopOpacity="0" /></radialGradient>
      <radialGradient id={exoticPurpleId} cx="78%" cy="105%" r="74%"><stop offset="0" stopColor="#b271fe" /><stop offset=".55" stopColor="#8c4aff" stopOpacity=".82" /><stop offset="1" stopColor="#8c4aff" stopOpacity="0" /></radialGradient>
      <radialGradient id={exoticBlueId} cx="5%" cy="92%" r="68%"><stop offset="0" stopColor="#57b0f8" /><stop offset=".58" stopColor="#31c4fe" stopOpacity=".72" /><stop offset="1" stopColor="#31c4fe" stopOpacity="0" /></radialGradient>
      <radialGradient id={ultimatePinkId} cx="2%" cy="8%" r="88%"><stop offset="0" stopColor="#d73cfe" /><stop offset=".5" stopColor="#d73cfe" stopOpacity=".9" /><stop offset="1" stopColor="#d73cfe" stopOpacity="0" /></radialGradient>
      <radialGradient id={ultimateBlueId} cx="100%" cy="14%" r="92%"><stop offset="0" stopColor="#63a5ff" /><stop offset=".5" stopColor="#63a5ff" stopOpacity=".94" /><stop offset="1" stopColor="#63a5ff" stopOpacity="0" /></radialGradient>
    </defs>
    <g transform="matrix(1.189007,0,0,1.189007,-48.385914,-48.385914)">
      <g transform="matrix(.707107,.707107,-.707107,.707107,256,-106.038672)">
        <ellipse cx="256" cy="256" rx="104" ry="222" className="sphere-mark-outline" strokeWidth="36" />
        <ellipse cx="256" cy="256" rx="104" ry="222" className="sphere-mark-trim" strokeWidth="22" />
      </g>
      <g className="sphere-mark-points-large">
        <path d="M390 72 458 54 440 122 390 72Z" />
        <path d="M122 440 54 458 72 390 122 440Z" />
      </g>
      <g transform="matrix(.753723,.657192,-.657192,.753723,231.28809,-105.194299)">
        <circle cx="256" cy="256" r="190" className="sphere-mark-core" strokeWidth="12" fill={`url(#${gradientId})`} />
        <g className="sphere-mark-exotic-layers">
          <circle cx="256" cy="256" r="184" fill={`url(#${exoticYellowId})`} />
          <circle cx="256" cy="256" r="184" fill={`url(#${exoticPinkId})`} />
          <circle cx="256" cy="256" r="184" fill={`url(#${exoticPurpleId})`} />
          <circle cx="256" cy="256" r="184" fill={`url(#${exoticBlueId})`} />
        </g>
        <g className="sphere-mark-ultimate-layers">
          <circle cx="256" cy="256" r="184" fill={`url(#${ultimatePinkId})`} />
          <circle cx="256" cy="256" r="184" fill={`url(#${ultimateBlueId})`} />
        </g>
      </g>
      <g className="sphere-mark-points-small">
        <path d="M88 128 128 88 145 145 88 128Z" />
        <path d="M424 384 384 424 367 367 424 384Z" />
      </g>
    </g>
    {label && <text x="256" y="315" textAnchor="middle" className="sphere-mark-label">{label.slice(0, 1).toUpperCase()}</text>}
  </svg>;
}
