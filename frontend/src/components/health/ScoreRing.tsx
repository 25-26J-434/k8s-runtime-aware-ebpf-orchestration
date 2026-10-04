import type { HealthLevel } from '../../types/health';
import { LEVEL_COLORS } from './levels';

interface ScoreRingProps {
    score: number;
    level: HealthLevel;
    size?: number;
    label?: string;
}

/** Circular 0-100 score gauge. */
export function ScoreRing({ score, level, size = 120, label }: ScoreRingProps) {
    const stroke = Math.max(8, size / 12);
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const hasScore = level !== 'unknown';
    const pct = hasScore ? Math.max(0, Math.min(100, score)) : 0;
    const color = LEVEL_COLORS[level];

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={`${label ?? 'Health'} score ${hasScore ? Math.round(score) : 'unavailable'}`}
        >
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth={stroke} />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.3s ease' }}
            />
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="#f8fafc" fontSize={size / 3.2} fontWeight={800}>
                {hasScore ? Math.round(score) : '–'}
            </text>
        </svg>
    );
}
