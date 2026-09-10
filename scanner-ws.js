const WebSocket = require('ws');
const http = require('http');
const net = require('net');
const url = require('url');

const PORT = 3334;

function checkPort(ip, port, timeout = 200) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timer = setTimeout(() => {
            socket.destroy();
            resolve(false);
        }, timeout);

        socket.once('connect', () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
        });

        socket.once('error', () => {
            clearTimeout(timer);
            resolve(false);
        });

        socket.connect(port, ip);
    });
}

const httpServer = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('Server is running. Connect with WebSocket.');
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const wss = new WebSocket.Server({ server: httpServer });

let currentScan = null;

wss.on('connection', (ws) => {
    console.log('✓ 客户端已连接');

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.cmd === 'scan') {
                if (currentScan) return;

                currentScan = { running: true };

                let ips = [];
                if (msg.ip.includes('*')) {
                    const prefix = msg.ip.replace('.*', '');
                    for (let i = 1; i <= 254; i++) {
                        ips.push(`${prefix}.${i}`);
                    }
                } else {
                    ips = [msg.ip];
                }

                let ports = [];
                if (msg.ports === 'all') {
                    ports = Array.from({ length: 65535 }, (_, i) => i + 1);
                } else if (msg.ports.includes('-')) {
                    const [start, end] = msg.ports.split('-').map(Number);
                    ports = Array.from({ length: end - start + 1 }, (_, i) => start + i);
                } else {
                    ports = [Number(msg.ports)];
                }

                const total = ips.length * ports.length;
                let current = 0;
                const found = [];

                console.log(`🔍 开始扫描: ${ips.length} IPs × ${ports.length} 端口 = ${total}`);

                const batchSize = 500;
                const tasks = [];

                for (const ip of ips) {
                    for (const port of ports) {
                        tasks.push(async () => {
                            if (!currentScan?.running) return;

                            const isOpen = await checkPort(ip, port, 100);
                            current++;

                            if (current % 100 === 0) {
                                const percent = Math.round((current / total) * 100);
                                ws.send(JSON.stringify({
                                    type: 'progress',
                                    current,
                                    total,
                                    percent
                                }));
                            }

                            if (isOpen) {
                                found.push({ ip, port });
                                ws.send(JSON.stringify({
                                    type: 'found',
                                    ip,
                                    port
                                }));
                                console.log(`  ✓ ${ip}:${port}`);
                            }
                        });
                    }
                }

                for (let i = 0; i < tasks.length; i += batchSize) {
                    if (!currentScan?.running) break;
                    const batch = tasks.slice(i, i + batchSize);
                    await Promise.all(batch.map(t => t()));
                }

                ws.send(JSON.stringify({
                    type: 'done',
                    count: found.length
                }));

                console.log(`✅ 完成! 找到 ${found.length} 个`);
                currentScan = null;
            }

            if (msg.cmd === 'stop') {
                if (currentScan) currentScan.running = false;
            }
        } catch (e) {
            console.error('错误:', e);
        }
    });
});

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════╗
║  ⚡ 高速扫描服务已启动              ║
║  访问: http://localhost:${PORT}       ║
╚═══════════════════════════════════╝
    `);
});
