const canvas = document.querySelector('#maze');
const context = canvas.getContext('2d');
const message = document.querySelector('#message');
const distanceValue = document.querySelector('#distance-value');
const newMazeButton = document.querySelector('#new-maze');
const restartButton = document.querySelector('#restart');

const columns = 15;
const rows = 15;
const start = { x: 0, y: 0 };
const end = { x: columns - 1, y: rows - 1 };
const directions = [
	{ x: 0, y: -1, wall: 'top', opposite: 'bottom' },
	{ x: 1, y: 0, wall: 'right', opposite: 'left' },
	{ x: 0, y: 1, wall: 'bottom', opposite: 'top' },
	{ x: -1, y: 0, wall: 'left', opposite: 'right' }
];

let cells = [];
let path = [];
let tracing = false;
let completed = false;
let retracting = false;
let visiblePathSegments = 0;
let retractionFrame = null;
let lastRetractionTime = 0;

function createCell(x, y) {
	return {
		x,
		y,
		visited: false,
		walls: { top: true, right: true, bottom: true, left: true }
	};
}

function getCell(x, y) {
	return cells[y]?.[x];
}

function createMaze() {
	cells = Array.from({ length: rows }, (_, y) =>
		Array.from({ length: columns }, (_, x) => createCell(x, y))
	);

	const stack = [getCell(start.x, start.y)];
	stack[0].visited = true;

	while (stack.length) {
		const current = stack[stack.length - 1];
		const neighbours = directions
			.map(direction => ({ direction, cell: getCell(current.x + direction.x, current.y + direction.y) }))
			.filter(neighbour => neighbour.cell && !neighbour.cell.visited);

		if (!neighbours.length) {
			stack.pop();
			continue;
		}

		const next = neighbours[Math.floor(Math.random() * neighbours.length)];
		current.walls[next.direction.wall] = false;
		next.cell.walls[next.direction.opposite] = false;
		next.cell.visited = true;
		stack.push(next.cell);
	}

	cells.flat().forEach(cell => { cell.visited = false; });
	restart();
}

function restart() {
	path = [];
	tracing = false;
	completed = false;
	retracting = false;
	visiblePathSegments = 0;
	if (retractionFrame) cancelAnimationFrame(retractionFrame);
	retractionFrame = null;
	message.textContent = 'Clique no ponto verde e mantenha o mouse pressionado para traçar o caminho.';
	draw();
}

function metrics() {
	const size = Math.min(canvas.clientWidth, canvas.clientHeight);
	const pixelRatio = window.devicePixelRatio || 1;
	canvas.width = Math.floor(size * pixelRatio);
	canvas.height = Math.floor(size * pixelRatio);
	context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
	return { size, cellSize: size / columns };
}

function draw(currentMetrics = metrics()) {
	const { size, cellSize } = currentMetrics;
	const millimetersPerGrid = 10;
	distanceValue.textContent = `${Math.round(Math.max(0, visiblePathSegments) * millimetersPerGrid)} mm`;
	context.clearRect(0, 0, size, size);

	context.strokeStyle = '#e2e8f0';
	context.lineWidth = Math.max(2, cellSize * 0.07);
	context.lineCap = 'round';
	context.beginPath();
	cells.flat().forEach(cell => {
		const x = cell.x * cellSize;
		const y = cell.y * cellSize;
		if (cell.walls.top) { context.moveTo(x, y); context.lineTo(x + cellSize, y); }
		if (cell.walls.right) { context.moveTo(x + cellSize, y); context.lineTo(x + cellSize, y + cellSize); }
		if (cell.walls.bottom) { context.moveTo(x + cellSize, y + cellSize); context.lineTo(x, y + cellSize); }
		if (cell.walls.left) { context.moveTo(x, y + cellSize); context.lineTo(x, y); }
	});
	context.stroke();

	drawMarker(start, '#55e6a5', cellSize);
	drawMarker(end, '#ff6685', cellSize);

	if (path.length) {
		context.strokeStyle = completed ? '#67e8f9' : '#f6c453';
		context.lineWidth = Math.max(5, cellSize * 0.27);
		context.lineJoin = 'round';
		context.beginPath();
		const drawnSegments = Math.min(visiblePathSegments, Math.max(0, path.length - 1));
		for (let index = 0; index < path.length; index++) {
			const cell = path[index];
			const x = (cell.x + .5) * cellSize;
			const y = (cell.y + .5) * cellSize;
			if (index === 0) {
				context.moveTo(x, y);
				continue;
			}
			if (drawnSegments >= index) context.lineTo(x, y);
			else {
				const previousCell = path[index - 1];
				const previousX = (previousCell.x + .5) * cellSize;
				const previousY = (previousCell.y + .5) * cellSize;
				const ratio = Math.max(0, drawnSegments - (index - 1));
				context.lineTo(previousX + (x - previousX) * ratio, previousY + (y - previousY) * ratio);
				break;
			}
		}
		context.stroke();
	}
}

function drawMarker(cell, color, cellSize) {
	context.fillStyle = color;
	context.beginPath();
	context.arc((cell.x + .5) * cellSize, (cell.y + .5) * cellSize, cellSize * .22, 0, Math.PI * 2);
	context.fill();
}

function cellFromEvent(event) {
	const rect = canvas.getBoundingClientRect();
	const x = Math.floor(((event.clientX - rect.left) / rect.width) * columns);
	const y = Math.floor(((event.clientY - rect.top) / rect.height) * rows);
	return getCell(x, y);
}

function canMove(from, to) {
	const direction = directions.find(direction => from.x + direction.x === to.x && from.y + direction.y === to.y);
	return direction && !from.walls[direction.wall];
}

function addCell(cell) {
	const previous = path[path.length - 1];
	if (cell === previous) return;
	if (path.length > 1 && cell === path[path.length - 2]) {
		path.pop();
		visiblePathSegments = Math.min(visiblePathSegments, Math.max(0, path.length - 1));
		draw();
		return;
	}
	if (!canMove(previous, cell) || path.includes(cell)) return;

	path.push(cell);
	visiblePathSegments = path.length - 1;
	if (cell.x === end.x && cell.y === end.y) {
		completed = true;
		tracing = false;
		message.textContent = 'Labirinto concluído!';
	}
	draw();
}

function retractPath(now) {
	if (!retracting) return;
	const delta = Math.min((now - lastRetractionTime) / 1000, .035);
	lastRetractionTime = now;
	const currentMetrics = metrics();
	visiblePathSegments = Math.max(0, visiblePathSegments - delta * 2000 / currentMetrics.cellSize);

	if (visiblePathSegments === 0) {
		path = [];
		retracting = false;
		retractionFrame = null;
	}

	draw(currentMetrics);
	if (retracting) retractionFrame = requestAnimationFrame(retractPath);
}

function releasePath() {
	tracing = false;
	if (completed || retracting) return;
	retracting = true;
	lastRetractionTime = performance.now();
	retractionFrame = requestAnimationFrame(retractPath);
}

canvas.addEventListener('pointerdown', event => {
	if (completed) return;
	const cell = cellFromEvent(event);
	if (cell?.x !== start.x || cell?.y !== start.y) return;
	path = [cell];
	tracing = true;
	retracting = false;
	visiblePathSegments = 0;
	if (retractionFrame) cancelAnimationFrame(retractionFrame);
	retractionFrame = null;
	canvas.setPointerCapture(event.pointerId);
	draw();
});

canvas.addEventListener('pointermove', event => {
	if (tracing && !completed) addCell(cellFromEvent(event));
});

canvas.addEventListener('pointerup', releasePath);

canvas.addEventListener('pointercancel', releasePath);

newMazeButton.addEventListener('click', createMaze);
restartButton.addEventListener('click', restart);
window.addEventListener('resize', draw);

createMaze();
