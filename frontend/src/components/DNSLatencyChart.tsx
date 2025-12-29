import { useEffect, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

interface DNSLatencyChartProps {
    currentLatency: number;
    title?: string;
}

export function DNSLatencyChart({ currentLatency, title = 'DNS Latency' }: DNSLatencyChartProps) {
    const [dataPoints, setDataPoints] = useState<number[]>([]);
    const [labels, setLabels] = useState<string[]>([]);
    const maxPoints = 20;

    useEffect(() => {
        const now = new Date();
        const timeLabel = now.toLocaleTimeString();

        setDataPoints(prev => {
            const newData = [...prev, currentLatency];
            return newData.slice(-maxPoints);
        });

        setLabels(prev => {
            const newLabels = [...prev, timeLabel];
            return newLabels.slice(-maxPoints);
        });
    }, [currentLatency]);

    const data = {
        labels,
        datasets: [
            {
                label: 'Latency (μs)',
                data: dataPoints,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderWidth: 2,
            }
        ]
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false,
            },
            title: {
                display: true,
                text: title,
                color: '#e4e4e7',
                font: {
                    size: 14,
                    weight: 'bold' as const,
                }
            },
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: '#e4e4e7',
                bodyColor: '#e4e4e7',
                borderColor: '#3b82f6',
                borderWidth: 1,
            }
        },
        scales: {
            x: {
                display: true,
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)',
                },
                ticks: {
                    color: '#71717a',
                    maxRotation: 45,
                    minRotation: 45,
                    font: {
                        size: 10,
                    }
                }
            },
            y: {
                display: true,
                beginAtZero: true,
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)',
                },
                ticks: {
                    color: '#71717a',
                    font: {
                        size: 10,
                    },
                    callback: function(value: number | string) {
                        return value + ' μs';
                    }
                }
            }
        }
    };

    return (
        <div style={{ height: '250px', width: '100%' }}>
            <Line data={data} options={options} />
        </div>
    );
}




