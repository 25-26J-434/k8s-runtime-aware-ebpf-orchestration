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

interface TCPIssuesChartProps {
    retransmissions: number;
    packetLoss: number;
    title?: string;
}

export function TCPIssuesChart({ retransmissions, packetLoss, title = 'TCP Issues' }: TCPIssuesChartProps) {
    const [retransData, setRetransData] = useState<number[]>([]);
    const [lossData, setLossData] = useState<number[]>([]);
    const [labels, setLabels] = useState<string[]>([]);
    const maxPoints = 20;

    useEffect(() => {
        const now = new Date();
        const timeLabel = now.toLocaleTimeString();

        setRetransData(prev => {
            const newData = [...prev, retransmissions];
            return newData.slice(-maxPoints);
        });

        setLossData(prev => {
            const newData = [...prev, packetLoss];
            return newData.slice(-maxPoints);
        });

        setLabels(prev => {
            const newLabels = [...prev, timeLabel];
            return newLabels.slice(-maxPoints);
        });
    }, [retransmissions, packetLoss]);

    const data = {
        labels,
        datasets: [
            {
                label: 'Retransmissions',
                data: retransData,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderWidth: 2,
            },
            {
                label: 'Packet Loss',
                data: lossData,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)',
                },
                ticks: {
                    color: '#71717a',
                    font: {
                        size: 10,
                    },
                    stepSize: 1,
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

