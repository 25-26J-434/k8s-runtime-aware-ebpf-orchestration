import { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

interface PacketDistributionChartProps {
    packetsByProtocol: Record<string, number>;
    title?: string;
}

export function PacketDistributionChart({ packetsByProtocol, title = 'Packet Distribution by Protocol' }: PacketDistributionChartProps) {
    const [chartData, setChartData] = useState<{ labels: string[], values: number[] }>({ labels: [], values: [] });

    useEffect(() => {
        const protocols = Object.keys(packetsByProtocol);
        const counts = Object.values(packetsByProtocol);
        
        setChartData({
            labels: protocols.map(p => p.toUpperCase()),
            values: counts as number[]
        });
    }, [packetsByProtocol]);

    const data = {
        labels: chartData.labels,
        datasets: [
            {
                label: 'Packets',
                data: chartData.values,
                backgroundColor: [
                    'rgba(59, 130, 246, 0.8)',
                    'rgba(139, 92, 246, 0.8)',
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(245, 158, 11, 0.8)',
                    'rgba(239, 68, 68, 0.8)',
                ],
                borderColor: [
                    '#3b82f6',
                    '#8b5cf6',
                    '#10b981',
                    '#f59e0b',
                    '#ef4444',
                ],
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
                    font: {
                        size: 11,
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
                        return value.toLocaleString();
                    }
                }
            }
        }
    };

    if (chartData.labels.length === 0) {
        return (
            <div style={{ height: '250px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a' }}>
                No packet data available
            </div>
        );
    }

    return (
        <div style={{ height: '250px', width: '100%' }}>
            <Bar data={data} options={options} />
        </div>
    );
}



