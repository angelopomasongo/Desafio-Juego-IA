// --- CONFIGURACIÓN BASE DE THREE.JS ---
const container = document.getElementById('game-container');
const aliveCountEl = document.getElementById('aliveCount');
const killsCountEl = document.getElementById('killsCount');
const zoneTimerEl = document.getElementById('zoneTimer');
const healthBarEl = document.getElementById('healthBar');
const ammoCountEl = document.getElementById('ammoCount');
const overlayEl = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const crosshairEl = document.getElementById('crosshair');

const MAP_SIZE = 800;
let isPlaying = false;
let isAiming = false;

// Evitar menú contextual con click derecho
window.addEventListener('contextmenu', e => e.preventDefault());

// Motor de audio Web Audio API
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (type === 'shoot') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } else if (type === 'hit') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(130, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } else if (type === 'reload') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(850, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  }
}

// Escena, Cámara FPS y Renderizador
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
scene.fog = new THREE.FogExp2(0x0f172a, 0.0025);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Iluminación
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
sunLight.position.set(200, 300, 100);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 1000;
const d = 500;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
scene.add(sunLight);

// Suelo 3D
const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(MAP_SIZE, 40, 0x38bdf8, 0x334155);
gridHelper.position.y = 0.1;
scene.add(gridHelper);

// --- ARMA EN PRIMERA PERSONA (FPS HANDS/GUN) ---
const fpsGunGroup = new THREE.Group();
const fpsGunBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.35, 0.35, 2.2),
  new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.2 })
);
fpsGunBody.position.set(0, 0, 0);

const fpsGunSight = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.2, 0.08),
  new THREE.MeshStandardMaterial({ color: 0xef4444 })
);
fpsGunSight.position.set(0, 0.22, -0.9);

fpsGunGroup.add(fpsGunBody, fpsGunSight);
camera.add(fpsGunGroup);
scene.add(camera);

// Posiciones del arma (Cadera vs Apuntando/ADS)
const gunHipPos = new THREE.Vector3(0.7, -0.55, -1.3);
const gunAimPos = new THREE.Vector3(0, -0.32, -1.0);
fpsGunGroup.position.copy(gunHipPos);

// --- ESTADO DEL JUEGO Y COLECCIONES ---
let player;
let bots = [];
let bullets = [];
let pickups = [];
let obstacles = [];

// Zona 3D (Cilindro de Tormenta)
const zoneMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
const zoneGeo = new THREE.CylinderGeometry(MAP_SIZE * 0.7, MAP_SIZE * 0.7, 120, 32, 1, true);
const zoneMesh = new THREE.Mesh(zoneGeo, zoneMat);
zoneMesh.position.y = 60;
scene.add(zoneMesh);

let zoneData = {
  x: 0,
  z: 0,
  radius: MAP_SIZE * 0.7,
  targetRadius: MAP_SIZE * 0.7,
  targetX: 0,
  targetZ: 0,
  timer: 30,
  isShrinking: false
};

// Controles de Vista en 1ra Persona
let yaw = 0;
let pitch = 0;
const keys = {};

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === document.body) {
    isPlaying = true;
  }
});

window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === document.body) {
    const sens = isAiming ? 0.0012 : 0.0025; // Sensibilidad reducida al apuntar
    yaw -= e.movementX * sens;
    pitch -= e.movementY * sens;
    pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));
  }
});

window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'r' && player) player.reload();
});

window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

window.addEventListener('mousedown', (e) => {
  if (!isPlaying) return;
  if (e.button === 0 && player && !player.isDead) {
    player.shoot();
  } else if (e.button === 2) { // Click derecho -> Apuntar (ADS)
    isAiming = true;
    crosshairEl.classList.add('aiming');
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 2) {
    isAiming = false;
    crosshairEl.classList.remove('aiming');
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- CLASES Y ENTIDADES ---

function createBotMesh() {
  const group = new THREE.Group();
  
  // Cuerpo del bot
  const bodyGeo = new THREE.CylinderGeometry(1.2, 1.2, 3.5, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 2.5;
  body.castShadow = true;
  group.add(body);

  // Cabeza
  const headGeo = new THREE.SphereGeometry(1, 16, 16);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf87171, roughness: 0.3 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 4.8;
  head.castShadow = true;
  group.add(head);

  // Arma
  const gunGeo = new THREE.BoxGeometry(0.5, 0.5, 2.5);
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
  const gun = new THREE.Mesh(gunGeo, gunMat);
  gun.position.set(1.2, 3, 1.2);
  gun.castShadow = true;
  group.add(gun);

  return group;
}

class Character {
  constructor(x, z, isBot = false, name = "Jugador") {
    this.isBot = isBot;
    this.name = name;
    this.radius = 1.8;
    this.speed = 0.8;
    this.health = 100;
    this.maxHealth = 100;
    this.ammo = 30;
    this.maxAmmo = 30;
    this.reserveAmmo = 90;
    this.kills = 0;
    this.isDead = false;
    this.lastShot = 0;
    this.angle = 0;

    if (isBot) {
      this.mesh = createBotMesh();
      this.mesh.position.set(x, 0, z);
      scene.add(this.mesh);
    } else {
      // Posición lógica del jugador humano en FPS
      this.pos = new THREE.Vector3(x, 0, z);
    }
  }

  getPosition() {
    return this.isBot ? this.mesh.position : this.pos;
  }

  update() {
    if (this.isDead) return;

    const currentPos = this.getPosition();

    // Daño fuera de la zona
    const distToZone = Math.hypot(currentPos.x - zoneData.x, currentPos.z - zoneData.z);
    if (distToZone > zoneData.radius) {
      this.health -= 0.15;
      if (this.health <= 0) this.die();
    }

    if (!this.isBot) {
      // Movimiento Jugador Humano en FPS
      let moveX = 0;
      let moveZ = 0;

      if (keys['w'] || keys['arrowup']) moveZ -= 1;
      if (keys['s'] || keys['arrowdown']) moveZ += 1;
      if (keys['a'] || keys['arrowleft']) moveX -= 1;
      if (keys['d'] || keys['arrowright']) moveX += 1;

      if (moveX !== 0 || moveZ !== 0) {
        const moveDir = new THREE.Vector3(moveX, 0, moveZ).normalize();
        moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        
        // Velocidad reducida ligeramente al apuntar
        const currentSpeed = isAiming ? this.speed * 0.55 : this.speed;
        this.move(moveDir.x * currentSpeed, moveDir.z * currentSpeed);
      }
    } else {
      this.updateBotAI();
    }
  }

  move(dx, dz) {
    const currentPos = this.getPosition();
    let nextX = currentPos.x + dx;
    let nextZ = currentPos.z + dz;

    const limit = MAP_SIZE / 2 - 5;
    nextX = Math.max(-limit, Math.min(limit, nextX));
    nextZ = Math.max(-limit, Math.min(limit, nextZ));

    // Colisión con Obstáculos
    for (let obs of obstacles) {
      const dist = Math.hypot(nextX - obs.position.x, nextZ - obs.position.z);
      if (dist < this.radius + obs.radius) {
        const angle = Math.atan2(nextZ - obs.position.z, nextX - obs.position.x);
        nextX = obs.position.x + Math.cos(angle) * (this.radius + obs.radius);
        nextZ = obs.position.z + Math.sin(angle) * (this.radius + obs.radius);
      }
    }

    currentPos.x = nextX;
    currentPos.z = nextZ;
  }

  updateBotAI() {
    const pos = this.mesh.position;
    const distToZoneCenter = Math.hypot(pos.x - zoneData.x, pos.z - zoneData.z);

    if (distToZoneCenter > zoneData.radius - 20) {
      this.angle = Math.atan2(zoneData.x - pos.x, zoneData.z - pos.z);
      this.mesh.rotation.y = this.angle;
      this.move(Math.sin(this.angle) * (this.speed * 0.7), Math.cos(this.angle) * (this.speed * 0.7));
      return;
    }

    let closestTarget = null;
    let minDistance = 130;

    if (player && !player.isDead) {
      const distToPlayer = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
      if (distToPlayer < minDistance) {
        minDistance = distToPlayer;
        closestTarget = player;
      }
    }

    for (let otherBot of bots) {
      if (otherBot !== this && !otherBot.isDead) {
        const distToBot = Math.hypot(otherBot.mesh.position.x - pos.x, otherBot.mesh.position.z - pos.z);
        if (distToBot < minDistance) {
          minDistance = distToBot;
          closestTarget = otherBot;
        }
      }
    }

    if (closestTarget) {
      const targetPos = closestTarget.getPosition();
      const dx = targetPos.x - pos.x;
      const dz = targetPos.z - pos.z;
      this.angle = Math.atan2(dx, dz);
      this.mesh.rotation.y = this.angle;

      if (minDistance < 95 && Date.now() - this.lastShot > 700) {
        this.shoot();
        this.lastShot = Date.now();
      }
    } else {
      if (Math.random() < 0.02) {
        this.angle += (Math.random() - 0.5) * 2;
        this.mesh.rotation.y = this.angle;
      }
    }

    this.move(Math.sin(this.angle) * (this.speed * 0.6), Math.cos(this.angle) * (this.speed * 0.6));
  }

  shoot() {
    if (this.ammo <= 0) {
      this.reload();
      return;
    }
    this.ammo--;
    playSound('shoot');

    let spawnPos, dir;

    if (!this.isBot) {
      // Disparo en 1ra persona desde la cámara/mira
      spawnPos = camera.position.clone();
      dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    } else {
      // Disparo desde bot 3D
      dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion);
      spawnPos = this.mesh.position.clone().add(new THREE.Vector3(0, 3, 0)).add(dir.clone().multiplyScalar(2));
    }

    bullets.push(new Bullet(spawnPos, dir, this));
  }

  reload() {
    if (this.reserveAmmo > 0 && this.ammo < this.maxAmmo) {
      playSound('reload');
      const needed = this.maxAmmo - this.ammo;
      const amount = Math.min(needed, this.reserveAmmo);
      this.ammo += amount;
      this.reserveAmmo -= amount;
    }
  }

  die() {
    this.isDead = true;
    const pos = this.getPosition();
    if (this.isBot) scene.remove(this.mesh);
    spawnPickup(pos.x, pos.z);
  }
}

class Bullet {
  constructor(pos, dir, shooter) {
    const geo = new THREE.SphereGeometry(0.35, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(pos);
    scene.add(this.mesh);

    this.dir = dir.normalize();
    this.speed = 4.0;
    this.shooter = shooter;
    this.isDead = false;
    this.distanceTraveled = 0;
    this.maxDistance = 300;
  }

  update() {
    const moveStep = this.dir.clone().multiplyScalar(this.speed);
    this.mesh.position.add(moveStep);
    this.distanceTraveled += this.speed;

    if (this.distanceTraveled >= this.maxDistance) {
      this.die();
      return;
    }

    // Impacto con Obstáculos
    for (let obs of obstacles) {
      if (Math.hypot(this.mesh.position.x - obs.position.x, this.mesh.position.z - obs.position.z) < obs.radius + 0.5) {
        this.die();
        return;
      }
    }

    // Impacto con Jugador Humano
    if (this.shooter !== player && player && !player.isDead) {
      if (Math.hypot(this.mesh.position.x - player.pos.x, this.mesh.position.z - player.pos.z) < player.radius + 0.5) {
        player.health -= 15;
        playSound('hit');
        this.die();
        if (player.health <= 0) {
          player.die();
          if (this.shooter) this.shooter.kills++;
        }
        return;
      }
    }

    // Impacto con Bots
    for (let bot of bots) {
      if (this.shooter !== bot && !bot.isDead) {
        if (Math.hypot(this.mesh.position.x - bot.mesh.position.x, this.mesh.position.z - bot.mesh.position.z) < bot.radius + 0.5) {
          bot.health -= 25;
          playSound('hit');
          this.die();
          if (bot.health <= 0) {
            bot.die();
            if (this.shooter) this.shooter.kills++;
          }
          return;
        }
      }
    }
  }

  die() {
    this.isDead = true;
    scene.remove(this.mesh);
  }
}

// --- MEDIO AMBIENTE Y PICKUPS ---

function generateEnvironment() {
  obstacles.forEach(o => scene.remove(o));
  obstacles = [];

  for (let i = 0; i < 70; i++) {
    const isTree = Math.random() > 0.4;
    const group = new THREE.Group();
    const x = (Math.random() - 0.5) * (MAP_SIZE - 60);
    const z = (Math.random() - 0.5) * (MAP_SIZE - 60);

    if (isTree) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 1, 6, 8),
        new THREE.MeshStandardMaterial({ color: 0x78350f })
      );
      trunk.position.y = 3;
      trunk.castShadow = true;
      group.add(trunk);

      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(4, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 })
      );
      leaves.position.y = 8;
      leaves.castShadow = true;
      group.add(leaves);

      group.radius = 2.5;
    } else {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(Math.random() * 2 + 2, 1),
        new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 })
      );
      rock.position.y = 2;
      rock.castShadow = true;
      group.add(rock);

      group.radius = 3;
    }

    group.position.set(x, 0, z);
    scene.add(group);
    obstacles.push(group);
  }
}

function spawnPickup(x, z) {
  const isHealth = Math.random() > 0.5;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.5, 1.5),
    new THREE.MeshStandardMaterial({ color: isHealth ? 0x22c55e : 0xeab308, metalness: 0.5 })
  );
  mesh.position.set(x, 1, z);
  mesh.castShadow = true;
  scene.add(mesh);

  pickups.push({ mesh, type: isHealth ? 'health' : 'ammo' });
}

function updatePickups() {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.mesh.rotation.y += 0.03;

    if (player && !player.isDead) {
      const dist = Math.hypot(player.pos.x - p.mesh.position.x, player.pos.z - p.mesh.position.z);
      if (dist < player.radius + 1.5) {
        if (p.type === 'health' && player.health < player.maxHealth) {
          player.health = Math.min(player.maxHealth, player.health + 35);
          scene.remove(p.mesh);
          pickups.splice(i, 1);
        } else if (p.type === 'ammo') {
          player.reserveAmmo += 30;
          scene.remove(p.mesh);
          pickups.splice(i, 1);
        }
      }
    }
  }
}

// --- ACTUALIZACIÓN DE LA ZONA ---

function updateZoneSystem() {
  if (zoneData.isShrinking) {
    zoneData.radius += (zoneData.targetRadius - zoneData.radius) * 0.002;
    zoneData.x += (zoneData.targetX - zoneData.x) * 0.002;
    zoneData.z += (zoneData.targetZ - zoneData.z) * 0.002;

    zoneMesh.scale.set(zoneData.radius / (MAP_SIZE * 0.7), 1, zoneData.radius / (MAP_SIZE * 0.7));
    zoneMesh.position.set(zoneData.x, 60, zoneData.z);

    if (Math.abs(zoneData.radius - zoneData.targetRadius) < 1) {
      zoneData.isShrinking = false;
      zoneData.timer = 20;
    }
  }
}

setInterval(() => {
  if (!isPlaying) return;
  if (zoneData.timer > 0 && !zoneData.isShrinking) {
    zoneData.timer--;
    zoneTimerEl.innerText = `${zoneData.timer}s`;
  } else if (zoneData.timer === 0 && !zoneData.isShrinking) {
    zoneData.isShrinking = true;
    zoneData.targetRadius = Math.max(30, zoneData.radius * 0.5);
    zoneData.targetX = zoneData.x + (Math.random() - 0.5) * (zoneData.radius - zoneData.targetRadius);
    zoneData.targetZ = zoneData.z + (Math.random() - 0.5) * (zoneData.radius - zoneData.targetRadius);
    zoneTimerEl.innerText = "¡EN MOVIMIENTO!";
  }
}, 1000);

// --- CÁMARA Y APUNTADO (FPS & ADS) ---

function updateFPSCamera() {
  if (!player || player.isDead) return;

  // Posicionar cámara a la altura de los ojos en 1ra persona
  camera.position.set(player.pos.x, 4.2, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // Transición suave de FOV (Zoom al apuntar ADS)
  const targetFov = isAiming ? 38 : 70;
  camera.fov += (targetFov - camera.fov) * 0.2;
  camera.updateProjectionMatrix();

  // Transición suave de posición del arma (Hipfire vs ADS)
  const targetGunPos = isAiming ? gunAimPos : gunHipPos;
  fpsGunGroup.position.lerp(targetGunPos, 0.2);
}

// --- BUCLE Y LÓGICA GENERAL ---

function initGame() {
  bots.forEach(b => scene.remove(b.mesh));
  bullets.forEach(b => scene.remove(b.mesh));
  pickups.forEach(p => scene.remove(p.mesh));

  bullets = [];
  pickups = [];

  generateEnvironment();

  player = new Character(0, 0, false, "Jugador");

  bots = [];
  for (let i = 0; i < 19; i++) {
    const x = (Math.random() - 0.5) * (MAP_SIZE - 100);
    const z = (Math.random() - 0.5) * (MAP_SIZE - 100);
    bots.push(new Character(x, z, true, `Bot_${i + 1}`));
  }

  zoneData.radius = MAP_SIZE * 0.7;
  zoneData.x = 0;
  zoneData.z = 0;
  zoneData.timer = 30;
  zoneData.isShrinking = false;

  zoneMesh.scale.set(1, 1, 1);
  zoneMesh.position.set(0, 60, 0);

  overlayEl.classList.remove('active');
  document.body.requestPointerLock();
}

function checkGameOver() {
  const aliveBots = bots.filter(b => !b.isDead).length;
  const aliveTotal = aliveBots + (player.isDead ? 0 : 1);

  aliveCountEl.innerText = aliveTotal;
  killsCountEl.innerText = player.kills;
  healthBarEl.style.width = `${Math.max(0, player.health)}%`;
  ammoCountEl.innerText = `${player.ammo} / ${player.reserveAmmo}`;

  if (player.isDead) {
    isPlaying = false;
    document.exitPointerLock();
    modalTitle.innerText = "¡HAS MUERTO!";
    modalSub.innerText = `Quedaste en la posición #${aliveTotal + 1} con ${player.kills} bajas.`;
    startBtn.innerText = "REINTENTAR";
    overlayEl.classList.add('active');
  } else if (aliveBots === 0) {
    isPlaying = false;
    document.exitPointerLock();
    modalTitle.innerText = "¡VICTORIA REAL!";
    modalSub.innerText = `¡Felicidades! Eliminaste a los enemigos en modo FPS con ${player.kills} bajas.`;
    startBtn.innerText = "JUGAR DE NUEVO";
    overlayEl.classList.add('active');
  }
}

function animate() {
  requestAnimationFrame(animate);

  if (isPlaying) {
    player.update();
    bots.forEach(b => b.update());
    bullets.forEach(b => b.update());
    bullets = bullets.filter(b => !b.isDead);

    updateZoneSystem();
    updatePickups();
    updateFPSCamera();
    checkGameOver();
  }

  renderer.render(scene, camera);
}

startBtn.addEventListener('click', () => {
  initGame();
});

animate();