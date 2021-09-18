Array.prototype.swap = function (x, y) {
	const b = this[x];
	this[x] = this[y];
	this[y] = b;
	return this;
};

const spawns = Object.values(Game.spawns);
const creeps = Object.values(Game.creeps);
const structures = Object.values(Game.structures);

for (const creepName in Memory.creeps) {
	if (!Game.creeps[creepName]) {
		delete Memory.creeps[creepName];
	}
}

for (const spawn of spawns) {
	spawn.creeps = [];
	spawn.upgraderMaxOps = 100;
}

for (const creep of creeps) {
	creep.ticks = creep.ticksToLive || CREEP_LIFE_TIME;
	creep.spawn = Game.spawns[creep.memory.spawn];
	creep.type = creep.memory.type;
	creep.identifier = creep.memory.identifier;
	creep.number = creep.memory.number;

	if (creep.spawn) {
		creep.spawn.creeps.push(creep);
	}

	if (!creep.store.getUsedCapacity()) {
		creep.memory.carrying = false;
	} else if (!creep.store.getFreeCapacity()) {
		creep.memory.carrying = true;
	}
	creep.carrying = creep.memory.carrying;
}

try {
	for (const structure of structures) {
		structure.needEnergy = structure.store && structure.store.getFreeCapacity(RESOURCE_ENERGY);
	}

	for (let i = 0; i < 10; i++) {
		for (const structure of structures) {
			if ([STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER].indexOf(structure.structureType) !== -1) {
				while (structure.needEnergy > 0) {
					const range = (i === 9 ? 50 : i + 1);
					const carrier = structure.pos.findClosestByRange(FIND_MY_CREEPS, {filter: carrier => carrier.type === 'c' && carrier.carrying && !carrier.structure && carrier.pos.inRangeTo(structure, range)});
					if (carrier) {
						carrier.structure = structure;
						structure.needEnergy -= carrier.store.getUsedCapacity();
					} else {
						break;
					}
				}
			}
		}
	}
} catch (error) {
	console.log(error.stack);
}

for (const structure of structures) {
	try {
		if (structure.structureType === STRUCTURE_TOWER) {
			const enemy = structure.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
			if (enemy) {
				structure.attack(enemy);
			} else {
				const ally = structure.pos.findClosestByRange(FIND_MY_CREEPS, {filter: creep => creep.hits < creep.hitsMax});
				if (ally) {
					structure.heal(ally);
				}
			}
		}
	} catch (error) {
		console.log(error.stack);
	}
}

try {
	const names = {e: STRUCTURE_EXTENSION, t: STRUCTURE_TOWER};
	for (let i = 0; i < 100; i++) {
		for (const name in names) {
			const structureFlag = Game.flags[`${name} ${i + 1}`];
			if (structureFlag && structureFlag.room) {
				if (structureFlag.pos.createConstructionSite(names[name]) === OK) {
					structureFlag.remove();
				}
			}
		}
	}
} catch (error) {
	console.log(error.stack);
}

for (const spawn of spawns) {
	try {
		spawn.queue = [];

		spawn.sourceFlags = [];
		for (let i = 0; i < 20; i++) {
			const sourceFlag = Game.flags[`s ${spawn.name} ${i}`];
			if (sourceFlag) {
				spawn.sourceFlags.push(sourceFlag);
			}
		}

		spawn.reservedRooms = [];
		for (const sourceFlag of spawn.sourceFlags) {
			try {
				sourceFlag.pathToController = PathFinder.search(sourceFlag.pos, {pos: spawn.room.controller.pos, range: 1});
				sourceFlag.source = sourceFlag.room && sourceFlag.pos.lookFor(LOOK_SOURCES)[0];
				sourceFlag.energyCapacity = (spawn.room.energyCapacityAvailable >= BODYPART_COST[CLAIM] + BODYPART_COST[MOVE] || sourceFlag.room === spawn.room ? SOURCE_ENERGY_CAPACITY : SOURCE_ENERGY_NEUTRAL_CAPACITY);
				sourceFlag.harvesterWorkPartsNeeded = Math.ceil((sourceFlag.energyCapacity * (CREEP_LIFE_TIME / ENERGY_REGEN_TIME)) / (HARVEST_POWER * CREEP_LIFE_TIME));
				sourceFlag.carrierCarryPartsNeeded = Math.ceil(((sourceFlag.pathToController.cost + 5) * 2) * (sourceFlag.harvesterWorkPartsNeeded * HARVEST_POWER) / BODYPART_COST[CARRY]);

				sourceFlag.harvesterWorkPartsQueued = 0;
				while (sourceFlag.harvesterWorkPartsQueued < sourceFlag.harvesterWorkPartsNeeded) {
					const carry = 1;
					const move = 1 + (spawn.room.energyCapacityAvailable >= 650 ? 1 : 0);
					const work = Math.min(sourceFlag.harvesterWorkPartsNeeded - sourceFlag.harvesterWorkPartsQueued, Math.floor((spawn.room.energyCapacityAvailable - (carry * BODYPART_COST[CARRY]) - (move * BODYPART_COST[MOVE])) / BODYPART_COST[WORK]));
					sourceFlag.harvesterWorkPartsQueued += work;
					spawn.queue.push({
						type: 'h',
						body: getBody({work, carry, move}),
						idParts: [sourceFlag.name, sourceFlag.harvesterWorkPartsQueued],
						backupTime: Math.ceil((sourceFlag.pathToController.cost + 3) * ((work + 1) / move)),
						memory: {
							sourceFlag: sourceFlag.name
						}
					});
				}

				sourceFlag.carrierCarryPartsQueued = 0;
				while (sourceFlag.carrierCarryPartsQueued < sourceFlag.carrierCarryPartsNeeded) {
					const carry = Math.min(3, sourceFlag.carrierCarryPartsNeeded - sourceFlag.carrierCarryPartsQueued, Math.floor(spawn.room.energyCapacityAvailable / (BODYPART_COST[CARRY] + BODYPART_COST[MOVE])));
					sourceFlag.carrierCarryPartsQueued += carry;
					spawn.queue.push({
						type: 'c',
						body: getBody({carry, move: carry}),
						idParts: [sourceFlag.name, sourceFlag.carrierCarryPartsQueued],
						backupTime: sourceFlag.pathToController.cost + 3,
						memory: {
							sourceFlag: sourceFlag.name
						}
					});
				}

				if (sourceFlag.room !== spawn.room && !spawn.reservedRooms[sourceFlag.pos.roomName]) {
					spawn.reservedRooms[sourceFlag.pos.roomName] = true;
					const claimPartsNeeded = 2;
					let claimPartsQueued = 0;
					while (claimPartsQueued < claimPartsNeeded) {
						const claim = Math.min(claimPartsNeeded - claimPartsQueued, Math.floor(spawn.room.energyCapacityAvailable / (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])));
						if (!claim) {
							break;
						}
						claimPartsQueued += claim;
						const pathToController = sourceFlag.room && PathFinder.search(spawn.pos, {pos: sourceFlag.room.controller.pos, range: 1});
						spawn.queue.push({
							type: 'r',
							body: getBody({claim, move: claim}),
							backupTime: ((pathToController && pathToController.cost) || 0) + 3,
							memory: {
								reserveRoom: sourceFlag.pos.roomName,
								sourceFlag: sourceFlag.name
							}
						});
					}
				}

				new RoomVisual(sourceFlag.pos.roomName).text(`W${sourceFlag.harvesterWorkPartsNeeded} C${sourceFlag.carrierCarryPartsNeeded}`, sourceFlag.pos.x, sourceFlag.pos.y + 2);
			} catch (error) {
				console.log(error.stack);
			}
		}

		{
			spawn.upgraderPositions = [];
			const controllerPos = spawn.room.controller.pos;

			for (let x = 0; x < 7; x++) {
				outerLoop:
				for (let y = 0; y < 7; y++) {
					if (x === 3 && y === 3) {
						continue;
					}
					const objects = spawn.room.lookAt(controllerPos.x + x - 3, controllerPos.y + y - 3);
					for (const object of objects) {
						if (object.type === LOOK_TERRAIN) {
							if (object.terrain === 'wall') {
								continue outerLoop;
							}
						}

						if (object.type === LOOK_STRUCTURES) {
							if (OBSTACLE_OBJECT_TYPES.indexOf(object.structure.structureType) !== -1) {
								continue outerLoop;
							}
						}
					}
					const pos = new RoomPosition(controllerPos.x + x - 3, controllerPos.y + y - 3, controllerPos.roomName);
					pos.number = spawn.upgraderPositions.length;
					spawn.upgraderPositions.push(pos);
				}
			}

			spawn.upgraderPositions.sort((a, b) => a.getRangeTo(controllerPos) - b.getRangeTo(controllerPos));
		}

		spawn.income = spawn.queue.reduce((income, creep) => income + (creep.type === 'h' ? creep.body.reduce((creepIncome, part) => creepIncome + (part === WORK ? 1 : 0), 0) : 0), 0) * HARVEST_POWER * CREEP_LIFE_TIME;
		spawn.income = spawn.income * .785;
		spawn.upgraderWorkPartsNeeded = Math.ceil(spawn.income / CREEP_LIFE_TIME);
		spawn.upgraderWorkPartsQueued = 0;
		spawn.upgradersQueued = 0;
		while (spawn.upgraderWorkPartsQueued < spawn.upgraderWorkPartsNeeded && spawn.upgradersQueued < spawn.upgraderPositions.length) {
			const move = 1;
			let carry = 1;
			let work = Math.min(spawn.upgraderWorkPartsNeeded - spawn.upgraderWorkPartsQueued, Math.floor((spawn.room.energyCapacityAvailable - (move * BODYPART_COST[MOVE]) - (carry * BODYPART_COST[CARRY])) / BODYPART_COST[WORK]));
			while (carry < Math.ceil(work / 4)) {
				work--;
				carry += 2;
			}
			spawn.upgraderWorkPartsQueued += work;
			spawn.upgradersQueued++;
			spawn.queue.push({
				type: 'u',
				body: getBody({work, carry, move})
			});
		}

		if (spawn.name === '1' && spawn.creeps.length < 3) {
			const firstHarvesterIndex = spawn.queue.findIndex(creep => creep.type === 'h');
			const firstHarvester = spawn.queue[firstHarvesterIndex];
			const firstCarrierIndex = spawn.queue.findIndex(creep => creep.type === 'c');
			const firstCarrier = spawn.queue[firstCarrierIndex];

			if (firstHarvester && firstCarrier) {
				spawn.queue.swap(firstHarvesterIndex + 1, firstCarrierIndex);
				firstHarvester.body = getBody({work: 1, move: 1, carry: 1});
				firstCarrier.body = getBody({carry: 1, move: 1});

				const secondCarrierIndex = spawn.queue.findIndex((creep, i) => i > firstCarrierIndex && creep.type === 'c');
				const secondCarrier = spawn.queue[secondCarrierIndex];
				if (secondCarrier) {
					spawn.queue.swap(firstHarvesterIndex + 2, secondCarrierIndex);
					secondCarrier.body = getBody({carry: 1, move: 1});
				}
			}
		}

		// Remove sources until queue length is in check.
		{
			const getQueuedParts = () => spawn.queue.reduce((queuedParts, creep) => queuedParts + creep.body.length, 0);
			let queuedParts = getQueuedParts();
			while (queuedParts > 480) {
				let endCreep;
				for (let i = spawn.queue.length - 1; i > -1; i--) {
					const creep = spawn.queue[i];
					if (creep.memory && creep.memory.sourceFlag) {
						endCreep = creep;
						break;
					}
				}
				if (endCreep) {
					const startCreep = spawn.queue.findIndex(creep => creep !== endCreep && creep.memory && creep.memory.sourceFlag === endCreep.memory.sourceFlag);
					if (startCreep !== -1) {
						spawn.queue.splice(startCreep, spawn.queue.indexOf(endCreep) - startCreep + 1);
					} else {
						break;
					}
				} else {
					break;
				}
				queuedParts = getQueuedParts();
			}
		}

		const spawnedCreepsByType = {};
		for (const creep of spawn.queue) {
			spawnedCreepsByType[creep.type] = (spawnedCreepsByType[creep.type] || 0) + 1;
			const creepNumber = spawnedCreepsByType[creep.type];
			const backupTime = (creep.body.length * 3) + (creep.backupTime || 0);

			const idParts = [spawn.name, creep.type];
			if (creep.idParts) {
				idParts.push(...creep.idParts);
			} else {
				idParts.push(creepNumber);
			}
			const identifier = idParts.join(',');

			if (spawn.creeps.find(creep => creep.identifier === identifier && creep.ticks > backupTime)) {
				continue;
			}

			spawn.spawnCreep(creep.body, `${spawn.name} ${creep.type}${creepNumber} ${Game.time % CREEP_LIFE_TIME}`, {
				memory: {
					spawn: spawn.name,
					type: creep.type,
					identifier,
					number: creepNumber,
					...creep.memory
				}
			});
			break;
		}

		spawn.queuedParts = spawn.queue.reduce((queuedParts, creep) => queuedParts + creep.body.length, 0);
		spawn.queuedPartsCost = spawn.queue.reduce((queuedPartsCost, creep) => queuedPartsCost + creep.body.reduce((creepCost, part) => creepCost + BODYPART_COST[part], 0), 0);
		spawn.room.visual.text(`P${spawn.queuedParts} C${spawn.queuedPartsCost.toLocaleString()} I${spawn.income.toLocaleString()} U${spawn.upgraderWorkPartsNeeded}`, spawn.pos.x, spawn.pos.y + 1);

		for (const creep of spawn.creeps) {
			try {
				if (creep.type === 'h') {
					const sourceFlag = Game.flags[creep.memory.sourceFlag];
					if (sourceFlag) {
						move(creep, sourceFlag, {reusePath: 0});
						creep.harvest(sourceFlag.source);
					}
				}

				if (creep.type === 'c') {
					const sourceFlag = Game.flags[creep.memory.sourceFlag];
					if (creep.carrying) {
						if (creep.room === spawn.room) {
							if (creep.structure) {
								move(creep, creep.structure, {reusePath: 0});
								creep.transfer(creep.structure, RESOURCE_ENERGY);
							} else {
								const upgrader = creep.pos.findClosestByPath(FIND_MY_CREEPS, {
									filter: upgrader => upgrader.type === 'u' && upgrader.store.getUsedCapacity() <= upgrader.store.getCapacity() * .5,
									maxOps: spawn.upgraderMaxOps
								});
								if (upgrader) {
									move(creep, upgrader);
									creep.transfer(upgrader, RESOURCE_ENERGY);
								} else {
									move(creep, sourceFlag.pathToController.path[sourceFlag.pathToController.path.length - 5]);
								}
							}
						} else {
							move(creep, spawn);
						}
					} else {
						if (sourceFlag) {
							if (creep.room === sourceFlag.room) {
								const harvester = sourceFlag.pos.findInRange(FIND_MY_CREEPS, 1, {filter: harvester => harvester.type === 'h' && harvester.store.getUsedCapacity()}).sort((a, b) => b.store.getUsedCapacity() - a.store.getUsedCapacity())[0];
								const pile = sourceFlag.pos.findInRange(FIND_DROPPED_RESOURCES, 1).sort((a, b) => b.amount - a.amount)[0];
								const target = ((!harvester || (pile && pile.amount > 50)) ? pile : harvester);
								if (target) {
									move(creep, target);
									if (target === pile) {
										creep.pickup(pile);
									} else {
										harvester.transfer(creep, RESOURCE_ENERGY);
									}
								} else {
									const waitFlag = Game.flags[sourceFlag.name.replace('s', 'sw')];
									if (waitFlag) {
										move(creep, waitFlag);
									} else {
										move(creep, sourceFlag.pathToController.path[2]);
									}
								}
							} else {
								move(creep, sourceFlag);
							}
						}
					}
				}

				if (creep.type === 'r') {
					const reserveRoom = Game.rooms[creep.memory.reserveRoom];
					if (reserveRoom) {
						move(creep, reserveRoom.controller);
						creep.reserveController(reserveRoom.controller);
					} else {
						move(creep, new RoomPosition(25, 25, creep.memory.reserveRoom));
					}
				}

				if (creep.type === 'u') {
					const site = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES);
					if (site) {
						move(creep, site, {reusePath: 0});
						creep.build(site);
						const getOutaHere = site.pos.lookFor(LOOK_CREEPS)[0];
						if (getOutaHere) {
							move(getOutaHere, spawn.room.controller);
						}
					} else {
						move(creep, spawn.upgraderPositions[creep.number - 1] || spawn.room.controller, {maxOps: spawn.upgraderMaxOps, reusePath: 0});
						creep.upgradeController(spawn.room.controller);
					}

					if (creep.store.getUsedCapacity() >= creep.store.getCapacity() * .25) {
						const poorNeighbor = creep.pos.findInRange(FIND_MY_CREEPS, 1, {filter: poorNeighbor => poorNeighbor.type === 'u'}).sort((a, b) => a.store.getUsedCapacity() - b.store.getUsedCapacity())[0];
						if (poorNeighbor && poorNeighbor.store.getFreeCapacity() >= creep.store.getUsedCapacity() * .25) {
							creep.transfer(poorNeighbor, RESOURCE_ENERGY, creep.store.getUsedCapacity() * .25);
						}
					}
				}
			} catch (error) {
				console.log(error.stack);
			}
		}
	} catch (error) {
		console.log(error.stack);
	}
}

try {
	if (!Memory.scores) {
		Memory.scores = [];
	}
	Memory.scores.unshift(Game.gcl.progress);
	Memory.scores.splice(1500);
	if (Memory.scores.length === 1500) {
		const spawn = Game.spawns['1'];
		if (spawn) {
			const remainingTicks = 604800 - Game.time;
			spawn.room.visual.text(Math.floor(remainingTicks / 1500) * (Memory.scores[0] - Memory.scores[1499]), spawn.room.controller.pos.x, spawn.room.controller.pos.y + 1);
		}
	}
} catch (error) {
	console.log(error.stack);
}

function move(creep, pos, options) {
	options = options || {};
	options.maxOps = options.maxOps || 2000;
	creep.moveTo(pos, options);
}

function getBody(parts) {
	const body = [];
	for (const key in parts) {
		body.push(...Array(parts[key]).fill(key));
	}
	return body;
}