const canvas = document.querySelector('#maze');
const context = canvas.getContext('2d');
const message = document.querySelector('#message');
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
let ropePath = [];
let pointer = null;
let committedCellKey = '';
let traversedCellKeys = new Set();
let dragging = false;
let retracting = false;
let completed = false;
let retractionDistance = 0;
let targetRopeLength = 0;
let visibleRopeLength = 0;
let ropeVelocity = 0;
let ropeNodes = [];
let activePointerId = null;
let lastFrame = performance.now();

function createCell(x, y) {
	return { x, y, visited: false, walls: { top: true, right: true, bottom: true, left: true } };
}

function getCell(x, y) {
	return cells[y]?.[x];
}

function getCellKeyFromPosition(position, cellSize) {
	return `${Math.floor(position.x / cellSize)},${Math.floor(position.y / cellSize)}`;
}

function createMaze() {
	const minimumSolutionLength = Math.floor(columns * rows * .38);
	let attempts = 0;
	do {
		generateMaze();
		attempts++;
	} while (getSolutionLength() < minimumSolutionLength && attempts < 40);

	cells.flat().forEach(cell => { cell.visited = false; });
	restart();
}

function generateMaze() {
	cells = Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => createCell(x, y)));
	const stack = [getCell(start.x, start.y)];
	stack[0].visited = true;

	while (stack.length) {
		const current = stack[stack.length - 1];
		const options = directions
			.map(direction => ({ direction, cell: getCell(current.x + direction.x, current.y + direction.y) }))
			.filter(option => option.cell && !option.cell.visited);
		if (!options.length) {
			stack.pop();
			continue;
		}
		const next = options[Math.floor(Math.random() * options.length)];
		current.walls[next.direction.wall] = false;
		next.cell.walls[next.direction.opposite] = false;
		next.cell.visited = true;
		stack.push(next.cell);
	}

}

function getSolutionLength() {
	const queue = [{ x: start.x, y: start.y, distance: 0 }];
	const visited = new Set([`${start.x},${start.y}`]);
	for (let index = 0; index < queue.length; index++) {
		const current = queue[index];
		if (current.x === end.x && current.y === end.y) return current.distance;
		const cell = getCell(current.x, current.y);
		for (const direction of directions) {
			if (cell.walls[direction.wall]) continue;
			const nextX = current.x + direction.x;
			const nextY = current.y + direction.y;
			const key = `${nextX},${nextY}`;
			if (!getCell(nextX, nextY) || visited.has(key)) continue;
			visited.add(key);
			queue.push({ x: nextX, y: nextY, distance: current.distance + 1 });
		}
	}
	return 0;
}

function getMetrics() {
	const size = Math.min(canvas.clientWidth, canvas.clientHeight);
	const ratio = window.devicePixelRatio || 1;
	canvas.width = Math.floor(size * ratio);
	canvas.height = Math.floor(size * ratio);
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	return { size, cellSize: size / columns, ropeRadius: Math.max(7, size / columns * .15) };
}

function centerOf(cell, cellSize) {
	return { x: (cell.x + .5) * cellSize, y: (cell.y + .5) * cellSize };
}

function restart() {
	const { cellSize } = getMetrics();
	const origin = centerOf(start, cellSize);
	ropePath = [{ ...origin }];
	pointer = { ...origin };
	committedCellKey = getCellKeyFromPosition(origin, cellSize);
	traversedCellKeys = new Set([committedCellKey]);
	dragging = false;
	retracting = false;
	completed = false;
	retractionDistance = 0;
	targetRopeLength = 0;
	visibleRopeLength = 0;
	ropeVelocity = 0;
	activePointerId = null;
	ropeNodes = Array.from({ length: 120 }, () => ({ x: origin.x, y: origin.y, px: origin.x, py: origin.y }));
	message.textContent = 'Clique no ponto verde e puxe o fio pelos corredores.';
	draw();
}

function positionFromEvent(event) {
	const rect = canvas.getBoundingClientRect();
	return {
		x: Math.max(0, Math.min(rect.width - .001, event.clientX - rect.left)),
		y: Math.max(0, Math.min(rect.height - .001, event.clientY - rect.top))
	};
}

function isInsideStart(position) {
	const { cellSize } = getMetrics();
	const origin = centerOf(start, cellSize);
	return Math.hypot(position.x - origin.x, position.y - origin.y) <= cellSize * .42;
}

function keepInsideCell(position, cell, cellSize, clearance) {
	const left = cell.x * cellSize;
	const right = left + cellSize;
	const top = cell.y * cellSize;
	const bottom = top + cellSize;
	if (cell.walls.left) position.x = Math.max(position.x, left + clearance);
	if (cell.walls.right) position.x = Math.min(position.x, right - clearance);
	if (cell.walls.top) position.y = Math.max(position.y, top + clearance);
	if (cell.walls.bottom) position.y = Math.min(position.y, bottom - clearance);
}

function sweepInsideMaze(from, to, cellSize, radius) {
	const clearance = radius + cellSize * .055;
	const distance = Math.hypot(to.x - from.x, to.y - from.y);
	const stepCount = Math.max(1, Math.ceil(distance / Math.max(1, radius * .25)));
	const stepX = (to.x - from.x) / stepCount;
	const stepY = (to.y - from.y) / stepCount;
	const position = { x: from.x, y: from.y };

	for (let index = 0; index < stepCount; index++) {
		const cell = getCell(Math.floor(position.x / cellSize), Math.floor(position.y / cellSize));
		if (!cell) break;
		const candidate = { x: position.x + stepX, y: position.y + stepY };
		const candidateCell = getCell(Math.floor(candidate.x / cellSize), Math.floor(candidate.y / cellSize));
		if (!candidateCell) {
			keepInsideCell(position, cell, cellSize, clearance);
			break;
		}

		const crossesRight = candidateCell.x > cell.x;
		const crossesLeft = candidateCell.x < cell.x;
		const crossesBottom = candidateCell.y > cell.y;
		const crossesTop = candidateCell.y < cell.y;
		if ((crossesRight && cell.walls.right) ||
			(crossesLeft && cell.walls.left) ||
			(crossesBottom && cell.walls.bottom) ||
			(crossesTop && cell.walls.top)) break;

		keepInsideCell(candidate, candidateCell, cellSize, clearance);
		position.x = candidate.x;
		position.y = candidate.y;
	}

	return position;
}

function addPathUntil(target, metrics) {
	let lastPoint = ropePath[ropePath.length - 1];
	const startPoint = { ...lastPoint };
	const distance = Math.hypot(target.x - lastPoint.x, target.y - lastPoint.y);
	const stepCount = Math.max(1, Math.ceil(distance / Math.max(2, metrics.ropeRadius * .32)));

	for (let index = 1; index <= stepCount; index++) {
		const desired = {
			x: startPoint.x + (target.x - startPoint.x) * index / stepCount,
			y: startPoint.y + (target.y - startPoint.y) * index / stepCount
		};
		const safePoint = sweepInsideMaze(lastPoint, desired, metrics.cellSize, metrics.ropeRadius);
		if (Math.hypot(safePoint.x - lastPoint.x, safePoint.y - lastPoint.y) < .01) break;
		ropePath.push(safePoint);
		lastPoint = safePoint;
	}

	pointer = { ...ropePath[ropePath.length - 1] };
}

function getPathLength() {
	return ropePath.reduce((length, point, index) => {
		if (!index) return length;
		const previousPoint = ropePath[index - 1];
		return length + Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
	}, 0);
}

function getPathPointAtDistance(distance) {
	let remainingDistance = Math.max(0, distance);
	for (let index = 1; index < ropePath.length; index++) {
		const previousPoint = ropePath[index - 1];
		const point = ropePath[index];
		const segmentLength = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
		if (remainingDistance <= segmentLength) {
			const ratio = segmentLength ? remainingDistance / segmentLength : 0;
			return {
				x: previousPoint.x + (point.x - previousPoint.x) * ratio,
				y: previousPoint.y + (point.y - previousPoint.y) * ratio
			};
		}
		remainingDistance -= segmentLength;
	}
	return { ...ropePath[ropePath.length - 1] };
}

function getVisiblePath() {
	const visiblePath = [ropePath[0]];
	let remainingLength = visibleRopeLength;
	for (let index = 1; index < ropePath.length; index++) {
		const previousPoint = ropePath[index - 1];
		const point = ropePath[index];
		const segmentLength = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
		if (remainingLength >= segmentLength) {
			visiblePath.push(point);
			remainingLength -= segmentLength;
			continue;
		}
		const ratio = segmentLength ? remainingLength / segmentLength : 0;
		visiblePath.push({
			x: previousPoint.x + (point.x - previousPoint.x) * ratio,
			y: previousPoint.y + (point.y - previousPoint.y) * ratio
		});
		break;
	}
	return visiblePath;
}

function updateElasticRope(delta) {
	const pathLength = getPathLength();
	if (retracting) targetRopeLength = Math.max(0, targetRopeLength - delta * 360);
	const springForce = (targetRopeLength - visibleRopeLength) * 240;
	ropeVelocity = (ropeVelocity + springForce * delta) * Math.pow(.012, delta);
	visibleRopeLength = Math.max(0, Math.min(pathLength, visibleRopeLength + ropeVelocity * delta));

	if (retracting && targetRopeLength === 0 && visibleRopeLength < .5) {
		retracting = false;
		visibleRopeLength = 0;
		ropeVelocity = 0;
		ropePath = [ropePath[0]];
		pointer = { ...ropePath[0] };
	}
}

function moveNode(node, target, metrics) {
	const safePosition = sweepInsideMaze(node, target, metrics.cellSize, metrics.ropeRadius);
	node.x = safePosition.x;
	node.y = safePosition.y;
}

function enforceRopeContinuity(restLength, metrics, origin) {
	const maxSegmentLength = Math.max(restLength * 2.8, metrics.cellSize * .42);
	for (let pass = 0; pass < 3; pass++) {
		const tail = ropeNodes[ropeNodes.length - 1];
		tail.x = origin.x;
		tail.y = origin.y;
		for (let index = ropeNodes.length - 2; index >= 0; index--) {
			const anchor = ropeNodes[index + 1];
			const node = ropeNodes[index];
			let safePosition = sweepInsideMaze(anchor, node, metrics.cellSize, metrics.ropeRadius);
			const distance = Math.hypot(safePosition.x - anchor.x, safePosition.y - anchor.y);
			if (distance > maxSegmentLength) {
				safePosition = sweepInsideMaze(anchor, {
					x: anchor.x + (safePosition.x - anchor.x) / distance * maxSegmentLength,
					y: anchor.y + (safePosition.y - anchor.y) / distance * maxSegmentLength
				}, metrics.cellSize, metrics.ropeRadius);
				node.px = safePosition.x;
				node.py = safePosition.y;
			}
			node.x = safePosition.x;
			node.y = safePosition.y;
		}
	}
}

function applyPathGlue(metrics) {
	const gluedLength = Math.min(visibleRopeLength, getPathLength());
	for (let index = 1; index < ropeNodes.length - 1; index++) {
		const node = ropeNodes[index];
		const desiredDistance = gluedLength * (1 - index / (ropeNodes.length - 1));
		const anchor = getPathPointAtDistance(desiredDistance);
		const gluedPosition = sweepInsideMaze(node, {
		x: node.x + (anchor.x - node.x) * .075,
		y: node.y + (anchor.y - node.y) * .075
		}, metrics.cellSize, metrics.ropeRadius);
		node.x = gluedPosition.x;
		node.y = gluedPosition.y;
	}
}

function simulateElasticRope(delta, metrics) {
	const origin = centerOf(start, metrics.cellSize);
	const head = ropeNodes[0];
	const headFollow = 1 - Math.exp(-28 * delta);
	head.px = head.x;
	head.py = head.y;
	moveNode(head, {
		x: head.x + (pointer.x - head.x) * headFollow,
		y: head.y + (pointer.y - head.y) * headFollow
	}, metrics);

	for (let index = 1; index < ropeNodes.length - 1; index++) {
		const node = ropeNodes[index];
		const velocityX = (node.x - node.px) * .88;
		const velocityY = (node.y - node.py) * .88;
		node.px = node.x;
		node.py = node.y;
		moveNode(node, { x: node.x + velocityX, y: node.y + velocityY }, metrics);
	}

	const tail = ropeNodes[ropeNodes.length - 1];
	tail.x = origin.x;
	tail.y = origin.y;
	tail.px = origin.x;
	tail.py = origin.y;
	const restLength = Math.max(2, visibleRopeLength / (ropeNodes.length - 1));

	for (let iteration = 0; iteration < 14; iteration++) {
		for (let index = 0; index < ropeNodes.length - 1; index++) {
			const first = ropeNodes[index];
			const second = ropeNodes[index + 1];
			const dx = second.x - first.x;
			const dy = second.y - first.y;
			const distance = Math.hypot(dx, dy);
			if (distance < .001) continue;
			const correction = Math.max(-.22, Math.min(.22, (distance - restLength) / distance));
			if (index === 0) {
				moveNode(second, { x: second.x - dx * correction, y: second.y - dy * correction }, metrics);
			} else if (index === ropeNodes.length - 2) {
				moveNode(first, { x: first.x + dx * correction, y: first.y + dy * correction }, metrics);
			} else {
				moveNode(first, { x: first.x + dx * correction * .5, y: first.y + dy * correction * .5 }, metrics);
				moveNode(second, { x: second.x - dx * correction * .5, y: second.y - dy * correction * .5 }, metrics);
			}
		}
		tail.x = origin.x;
		tail.y = origin.y;
	}
	applyPathGlue(metrics);
	enforceRopeContinuity(restLength, metrics, origin);
}

function update(now) {
	const delta = Math.min((now - lastFrame) / 1000, .035);
	lastFrame = now;
	const metrics = getMetrics();
	updateElasticRope(delta);
	simulateElasticRope(delta, metrics);
	draw(metrics);
	requestAnimationFrame(update);
}

function orientation(first, second, third) {
	return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
	const first = orientation(firstStart, firstEnd, secondStart);
	const second = orientation(firstStart, firstEnd, secondEnd);
	const third = orientation(secondStart, secondEnd, firstStart);
	const fourth = orientation(secondStart, secondEnd, firstEnd);
	return first * second <= 0 && third * fourth <= 0;
}

function segmentHitsMazeWall(startPoint, endPoint, cellSize) {
	for (const cell of cells.flat()) {
		const left = cell.x * cellSize;
		const right = left + cellSize;
		const top = cell.y * cellSize;
		const bottom = top + cellSize;
		const walls = [];
		if (cell.walls.top) walls.push([{ x: left, y: top }, { x: right, y: top }]);
		if (cell.walls.left) walls.push([{ x: left, y: top }, { x: left, y: bottom }]);
		if (cell.x === columns - 1 && cell.walls.right) walls.push([{ x: right, y: top }, { x: right, y: bottom }]);
		if (cell.y === rows - 1 && cell.walls.bottom) walls.push([{ x: left, y: bottom }, { x: right, y: bottom }]);
		if (walls.some(([wallStart, wallEnd]) => segmentsIntersect(startPoint, endPoint, wallStart, wallEnd))) return true;
	}
	return false;
}

function draw(metrics) {
	const { size, cellSize, ropeRadius } = metrics || getMetrics();
	context.clearRect(0, 0, size, size);
	context.fillStyle = '#131722';
	context.fillRect(0, 0, size, size);

	context.strokeStyle = '#e2e8f0';
	context.lineWidth = Math.max(3, cellSize * .075);
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
	if (ropeNodes.length > 1) {
		context.strokeStyle = '#f6c453';
		context.lineWidth = ropeRadius * 2;
		context.lineCap = 'round';
		context.lineJoin = 'round';
		context.beginPath();
		const maxVisibleSegment = Math.max(cellSize * .45, visibleRopeLength / (ropeNodes.length - 1) * 4);
		ropeNodes.forEach((node, index) => {
			if (!index) context.moveTo(node.x, node.y);
			else {
				const previousNode = ropeNodes[index - 1];
				if (Math.hypot(node.x - previousNode.x, node.y - previousNode.y) > maxVisibleSegment || segmentHitsMazeWall(previousNode, node, cellSize)) context.moveTo(node.x, node.y);
				else context.lineTo(node.x, node.y);
			}
		});
		context.stroke();
	}

	const head = ropeNodes[0];
	context.fillStyle = '#f6c453';
	context.beginPath();
	context.arc(head.x, head.y, ropeRadius, 0, Math.PI * 2);
	context.fill();
	if (visibleRopeLength < .5) drawMarker(start, '#55e6a5', cellSize);
}

function drawMarker(cell, color, cellSize) {
	const position = centerOf(cell, cellSize);
	context.fillStyle = color;
	context.beginPath();
	context.arc(position.x, position.y, cellSize * .19, 0, Math.PI * 2);
	context.fill();
}

canvas.addEventListener('pointerdown', event => {
	if (completed) return;
	const position = positionFromEvent(event);
	if (!isInsideStart(position)) return;
	dragging = true;
	retracting = false;
	retractionDistance = 0;
	const metrics = getMetrics();
	const origin = centerOf(start, metrics.cellSize);
	ropePath = [{ ...origin }];
	pointer = { ...origin };
	committedCellKey = getCellKeyFromPosition(origin, metrics.cellSize);
	traversedCellKeys = new Set([committedCellKey]);
	targetRopeLength = 0;
	visibleRopeLength = 0;
	ropeVelocity = 0;
	ropeNodes = Array.from({ length: 120 }, () => ({ x: origin.x, y: origin.y, px: origin.x, py: origin.y }));
	activePointerId = event.pointerId;
	canvas.setPointerCapture(event.pointerId);
});

function updateRopePointer(event) {
	if (!dragging || completed || event.pointerId !== activePointerId) return;
	const metrics = getMetrics();
	const rawPointer = positionFromEvent(event);
	const safePointer = sweepInsideMaze(pointer, rawPointer, metrics.cellSize, metrics.ropeRadius);
	const nextCellKey = getCellKeyFromPosition(safePointer, metrics.cellSize);
	if (nextCellKey !== committedCellKey && !traversedCellKeys.has(nextCellKey)) {
		addPathUntil(safePointer, metrics);
		committedCellKey = nextCellKey;
		traversedCellKeys.add(nextCellKey);
		targetRopeLength = getPathLength();
	} else {
		pointer = safePointer;
	}
	const finish = centerOf(end, metrics.cellSize);
	if (Math.hypot(pointer.x - finish.x, pointer.y - finish.y) < metrics.cellSize * .23) {
		completed = true;
		dragging = false;
		message.textContent = 'Labirinto concluído!';
	}

}

function releaseRopePointer(event) {
	if (event.pointerId !== activePointerId) return;
	dragging = false;
	retracting = true;
	activePointerId = null;
}

canvas.addEventListener('pointermove', updateRopePointer);
window.addEventListener('pointermove', updateRopePointer);
canvas.addEventListener('pointerup', releaseRopePointer);
window.addEventListener('pointerup', releaseRopePointer);
canvas.addEventListener('pointercancel', releaseRopePointer);
window.addEventListener('pointercancel', releaseRopePointer);
newMazeButton.addEventListener('click', createMaze);
restartButton.addEventListener('click', restart);
window.addEventListener('resize', restart);

createMaze();
requestAnimationFrame(update);
