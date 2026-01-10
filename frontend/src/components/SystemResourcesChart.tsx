import { useEffect, useState } from 'react';
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

interface SystemResourcesChartProps {
    cpuUsage: number; // percentage
    memoryUsage: number; // percentage
    title?: string;
}

export function SystemResourcesChart({ cpuUsage, memoryUsage, title = 'System Resources' }: SystemResourcesChartProps) {
    const [cpuData, setCpuData] = useState<number[]>([]);
    const [memoryData, setMemoryData] = useState<number[]>([]);
    const [labels, setLabels] = useState<string[]>([]);
    const maxPoints = 20;

    useEffect(() => {
        const now = new Date();
        const timeLabel = now.toLocaleTimeString();

        setCpuData(prev => {
            const newData = [...prev, cpuUsage];
            return newData.slice(-maxPoints);
        });

        setMemoryData(prev => {
            const newData = [...prev, memoryUsage];
            return newData.slice(-maxPoints);
        });

        setLabels(prev => {
            const newLabels = [...prev, timeLabel];
            return newLabels.slice(-maxPoints);
        });
    }, [cpuUsage, memoryUsage]);

    const data = {
        labels,
        datasets: [
            {
                label: 'CPU Usage (%)',
                data: cpuData,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderWidth: 2,
            },
            {
                label: 'Memory Usage (%)',
                data: memoryData,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
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
                display: true,
                position: 'top' as const,
                labels: {
                    color: '#e4e4e7',
                    font: {
                        size: 11,
                    }
                }
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
                max: 100,
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)',
                },
                ticks: {
                    color: '#71717a',
                    font: {
                        size: 10,
                    },
                    callback: function(value: number | string) {
                        return value + '%';
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



