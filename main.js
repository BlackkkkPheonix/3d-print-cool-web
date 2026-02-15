import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';

// Simple clipping helper for "splitting"
class App {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0c);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(5, 5, 5);

        this.renderer = new THREE.WebGLRenderer({
            canvas: document.querySelector('#canvas'),
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.controls.enabled = !event.value;
        });
        this.scene.add(this.transformControls);

        this.transformControls.addEventListener('object-changed', () => {
            this.updateDeleteButtonText();
        });

        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 10, 7.5);
        this.scene.add(directionalLight);

        // Grid helper
        const grid = new THREE.GridHelper(20, 20, 0x00f2ff, 0x222222);
        grid.material.opacity = 0.2;
        grid.material.transparent = true;
        this.scene.add(grid);

        this.meshes = [];
        this.currentDrawPoints = [];
        this.isSelecting = true;
        this.isDrawing = false;
        this.isStraight = false;
        this.isCarving = false;
        this.isScaling = false;
        this.isMerging = false;
        this.isCircleCarving = false;
        this.isCircleDrawing = false;
        this.isBending = false;
        this.isSketchCarving = false;
        this.lastCarve = null;
        this.currentProjectName = "Untitled Project";

        this.initUI();
        this.updateProjectList();
        this.animate();

        window.addEventListener('resize', () => this.onResize());
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    initUI() {
        const selectBtn = document.getElementById('id-btn-select');
        selectBtn.onclick = () => this.toggleTool('select', selectBtn);

        document.getElementById('btn-clear').onclick = () => this.clearAll();

        document.getElementById('btn-cube').onclick = () => this.addPrimitive('cube');
        document.getElementById('btn-sphere').onclick = () => this.addPrimitive('sphere');
        document.getElementById('btn-cylinder').onclick = () => this.addPrimitive('cylinder');
        document.getElementById('btn-cone').onclick = () => this.addPrimitive('cone');
        document.getElementById('btn-circle').onclick = () => this.addPrimitive('circle');
        document.getElementById('btn-ring').onclick = () => this.addPrimitive('ring');

        const drawBtn = document.getElementById('btn-draw');
        drawBtn.onclick = () => this.toggleTool('draw', drawBtn);

        const circleDrawBtn = document.getElementById('btn-circle-draw');
        circleDrawBtn.onclick = () => this.toggleTool('circle-draw', circleDrawBtn);

        const straightBtn = document.getElementById('btn-straight');
        straightBtn.onclick = () => {
            this.isStraight = !this.isStraight;
            straightBtn.innerText = `Straight Lines: ${this.isStraight ? 'ON' : 'OFF'}`;
            straightBtn.classList.toggle('on');
        };

        document.getElementById('btn-shapeify').onclick = () => this.shapeify();

        const carveBtn = document.getElementById('btn-carve');
        carveBtn.onclick = () => this.toggleTool('carve', carveBtn);

        const scaleBtn = document.getElementById('btn-scale');
        scaleBtn.onclick = () => this.toggleTool('scale', scaleBtn);

        const circleCarveBtn = document.getElementById('btn-circle-carve');
        circleCarveBtn.onclick = () => this.toggleTool('circle-carve', circleCarveBtn);

        const bendBtn = document.getElementById('btn-bend');
        bendBtn.onclick = () => this.toggleTool('bend', bendBtn);

        const sketchCarveBtn = document.getElementById('btn-sketch-carve');
        sketchCarveBtn.onclick = () => this.toggleTool('sketch-carve', sketchCarveBtn);

        const mergeBtn = document.getElementById('btn-merge');
        mergeBtn.onclick = () => this.mergeAll();

        document.getElementById('btn-repeat-no-mode').onclick = () => this.showRepeatOptions('normal');
        document.getElementById('btn-repeat-equal-mode').onclick = () => this.showRepeatOptions('equal');
        document.getElementById('btn-repeat-dismiss').onclick = () => this.hideRepeatPrompt();

        document.getElementById('btn-repeat-apply-normal').onclick = () => this.repeatLastCarve();
        document.getElementById('btn-repeat-apply-equal').onclick = () => this.repeatMultiCarve();

        document.querySelectorAll('.btn-repeat-back').forEach(btn => {
            btn.onclick = () => this.showRepeatOptions('choices');
        });

        document.getElementById('btn-export').onclick = () => this.exportDesign();

        // Project Management Bindings
        document.getElementById('btn-project-save').onclick = () => this.saveProject();
        document.getElementById('btn-project-new').onclick = () => this.newProject();
        document.getElementById('btn-project-delete').onclick = () => this.deleteSelectedProject();
        document.getElementById('project-list').onchange = (e) => this.loadProject(e.target.value);
        document.getElementById('btn-delete-shape').onclick = () => this.deleteSelectedShape();

        // Event listeners for drawing
        this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.renderer.domElement.addEventListener('pointerup', () => this.onPointerUp());
    }

    toggleTool(tool, btn) {
        const isActive = btn.classList.contains('active');

        // Reset others
        this.isSelecting = false;
        this.isDrawing = false;
        this.isCarving = false;
        this.isScaling = false;
        this.isCircleCarving = false;
        this.isCircleDrawing = false;
        this.isBending = false;
        this.isSketchCarving = false;
        this.transformControls.detach();
        this.hideRepeatPrompt();
        document.querySelectorAll('button').forEach(b => b.classList.remove('active'));

        // Toggle back to select if clicking active tool
        if (isActive && tool !== 'select') {
            this.isSelecting = true;
            document.getElementById('id-btn-select').classList.add('active');
            this.showNotification("Return to Selection mode.");
            return;
        }

        if (tool === 'select') {
            this.isSelecting = true;
            btn.classList.add('active');
            this.showNotification("Select mode active. Move or scale shapes.");
        } else if (tool === 'draw') {
            this.isDrawing = true;
            btn.classList.add('active');
            this.showNotification("Drawing mode active. Drag to sketch.");
        } else if (tool === 'carve') {
            this.isCarving = true;
            btn.classList.add('active');
            this.showNotification("Carve mode active. Select a shape to split.");
        } else if (tool === 'scale') {
            this.isScaling = true;
            btn.classList.add('active');
            this.showNotification("Scale mode active. Click a shape to resize it.");
        } else if (tool === 'circle-carve') {
            this.isCircleCarving = true;
            btn.classList.add('active');
            this.showNotification("Circle Carve active. Click to punch a hole!");
        } else if (tool === 'circle-draw') {
            this.isCircleDrawing = true;
            btn.classList.add('active');
            this.showNotification("Circle Draw active. Click and drag to set radius.");
        } else if (tool === 'bend') {
            this.isBending = true;
            btn.classList.add('active');
            this.showNotification("Bend mode active. Click a shape to curve it.");
        } else if (tool === 'sketch-carve') {
            this.isSketchCarving = true;
            btn.classList.add('active');
            this.showNotification("Sketch Carve active. Draw a shape to punch it through!");
        }
    }

    clearAll(silent = false) {
        if (silent || confirm("Clear your entire design?")) {
            this.meshes.forEach(m => this.scene.remove(m));
            this.meshes = [];
            this.transformControls.detach();
            this.updateDeleteButtonText();
            if (!silent) this.showNotification("Design cleared.");
        }
    }

    deleteSelectedShape() {
        if (this.transformControls.object) {
            const mesh = this.transformControls.object;
            const name = this.getMeshName(mesh);
            if (confirm(`Are you sure you want to delete this ${name}?`)) {
                this.scene.remove(mesh);
                this.meshes = this.meshes.filter(m => m !== mesh);
                this.transformControls.detach();
                this.updateDeleteButtonText();
                this.showNotification(`${name} deleted.`);
            }
        } else {
            this.showNotification("Select a shape first! (Use the Select Tool)");
        }
    }

    updateDeleteButtonText() {
        const btn = document.getElementById('btn-delete-shape');
        if (this.transformControls.object) {
            const name = this.getMeshName(this.transformControls.object);
            btn.innerText = `Delete ${name}`;
            btn.style.opacity = "1";
        } else {
            btn.innerText = `Delete Shape`;
            btn.style.opacity = "0.5";
        }
    }

    getMeshName(mesh) {
        if (!mesh || !mesh.geometry) return "Shape";
        const type = mesh.geometry.type;
        if (type === 'BoxGeometry') return "Cube";
        if (type === 'SphereGeometry') return "Sphere";
        if (type === 'CylinderGeometry') return "Cylinder";
        if (type === 'ConeGeometry') return "Cone";
        if (type === 'TorusGeometry') return "Circle";
        if (type === 'RingGeometry') return "Ring";
        if (type === 'TubeGeometry') return "Sketch";
        return "Shape";
    }

    // PROJECT MANAGEMENT
    serializeScene() {
        const data = this.meshes.map(m => {
            return {
                type: m.geometry.type,
                parameters: m.geometry.parameters,
                position: m.position.toArray(),
                rotation: m.rotation.toArray(),
                scale: m.scale.toArray(),
                color: m.material.color.getHex()
            };
        });
        return JSON.stringify(data);
    }

    saveProject() {
        const name = prompt("Project Name:", this.currentProjectName) || this.currentProjectName;
        const projects = JSON.parse(localStorage.getItem('3d-artisan-projects') || '{}');
        projects[name] = this.serializeScene();
        localStorage.setItem('3d-artisan-projects', JSON.stringify(projects));
        this.currentProjectName = name;
        this.updateProjectList();
        this.showNotification(`Project "${name}" saved!`);
    }

    loadProject(name) {
        if (!name) return;
        const projects = JSON.parse(localStorage.getItem('3d-artisan-projects') || '{}');
        const data = JSON.parse(projects[name]);
        if (!data) return;

        this.clearAll(true);
        data.forEach(item => {
            let geometry;
            // Reconstruct geometries based on type
            if (item.type === 'BoxGeometry') geometry = new THREE.BoxGeometry(...Object.values(item.parameters));
            else if (item.type === 'SphereGeometry') geometry = new THREE.SphereGeometry(...Object.values(item.parameters));
            else if (item.type === 'CylinderGeometry') geometry = new THREE.CylinderGeometry(...Object.values(item.parameters));
            else if (item.type === 'ConeGeometry') geometry = new THREE.ConeGeometry(...Object.values(item.parameters));
            else if (item.type === 'TorusGeometry') geometry = new THREE.TorusGeometry(...Object.values(item.parameters));
            else geometry = new THREE.BoxGeometry(1, 1, 1); // Fallback

            const material = new THREE.MeshStandardMaterial({
                color: item.color,
                transparent: true,
                opacity: 0.8,
                metalness: 0.5,
                roughness: 0.2
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.fromArray(item.position);
            mesh.rotation.fromArray(item.rotation);
            mesh.scale.fromArray(item.scale);

            this.scene.add(mesh);
            this.meshes.push(mesh);
        });

        this.currentProjectName = name;
        this.showNotification(`Loaded "${name}"`);
    }

    deleteSelectedProject() {
        const select = document.getElementById('project-list');
        const name = select.value;
        if (!name) return;

        if (confirm(`Delete project "${name}"?`)) {
            const projects = JSON.parse(localStorage.getItem('3d-artisan-projects') || '{}');
            delete projects[name];
            localStorage.setItem('3d-artisan-projects', JSON.stringify(projects));
            this.updateProjectList();
            this.newProject();
            this.showNotification("Project deleted.");
        }
    }

    newProject() {
        this.clearAll(true);
        this.currentProjectName = "Untitled Project";
        document.getElementById('project-list').value = "";
        this.showNotification("New Project started.");
    }

    updateProjectList() {
        const select = document.getElementById('project-list');
        const projects = JSON.parse(localStorage.getItem('3d-artisan-projects') || '{}');

        // Preserve current value if it still exists
        const currentVal = select.value;

        select.innerHTML = '<option value="">-- Select Project --</option>';
        Object.keys(projects).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });

        if (projects[currentVal]) select.value = currentVal;
    }

    addPrimitive(type, position = null) {
        let geometry;
        const material = new THREE.MeshStandardMaterial({
            color: 0x00f2ff,
            transparent: true,
            opacity: 0.8,
            metalness: 0.5,
            roughness: 0.2
        });

        switch (type) {
            case 'cube': geometry = new THREE.BoxGeometry(1, 1, 1); break;
            case 'sphere': geometry = new THREE.SphereGeometry(0.7, 32, 32); break;
            case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
            case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
            case 'circle': geometry = new THREE.TorusGeometry(0.5, 0.05, 32, 128); break;
            case 'ring': geometry = new THREE.RingGeometry(0.3, 0.6, 128); break;
        }

        const mesh = new THREE.Mesh(geometry, material);
        if (position) {
            mesh.position.copy(position);
        } else {
            mesh.position.set(Math.random() * 2 - 1, 0.5, Math.random() * 2 - 1);
        }

        this.scene.add(mesh);
        this.meshes.push(mesh);

        if (type === 'circle' || type === 'ring') {
            this.storeLastCarve(type + 'Primitive', { type, position: mesh.position.clone() });
        }
    }

    onPointerDown(event) {
        this.hideRepeatPrompt();
        if (this.isSelecting) {
            this.handleSelection(event);
            return;
        }
        if (this.isCarving) {
            this.handleCarve(event);
            return;
        }
        if (this.isScaling) {
            this.handleScale(event);
            return;
        }
        if (this.isCircleCarving) {
            this.handleCircleCarve(event);
            return;
        }
        if (this.isCircleDrawing) {
            this.startCircleDraw(event);
            return;
        }
        if (this.isBending) {
            this.handleBend(event);
            return;
        }
        if (this.isSketchCarving) {
            this.isDrawing = true;
            this.controls.enabled = false;
            this.currentDrawPoints = [];
            return;
        }
        if (!this.isDrawing) return;
        this.controls.enabled = false;
        this.currentDrawPoints = [];
    }

    onPointerMove(event) {
        if (this.isScaling) return;
        if (this.isCircleDrawing) {
            this.updateCircleDraw(event);
            return;
        }
        if (!this.isDrawing || this.currentDrawPoints.length === 0) return;

        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // For drawing, we'll project onto a plane at z=0 if no intersection
        let point = new THREE.Vector3();
        this.raycaster.ray.at(5, point); // Default depth

        if (this.isStraight && this.currentDrawPoints.length > 0) {
            // Only keep first and current
            this.currentDrawPoints = [this.currentDrawPoints[0], point];
        } else {
            this.currentDrawPoints.push(point);
        }

        this.updateDrawingPreview();
    }

    onPointerUp() {
        if (this.isCircleDrawing) {
            this.finishCircleDraw();
            return;
        }
        if (this.isSketchCarving) {
            this.finishSketchCarve();
            this.isDrawing = false;
            this.controls.enabled = true;
            return;
        }
        if (!this.isDrawing) return;
        this.controls.enabled = true;

        // Check if drawing is "2D" (all points in roughly same plane)
        this.check2DStatus();
    }

    updateDrawingPreview() {
        if (this.previewLine) this.scene.remove(this.previewLine);

        if (this.currentDrawPoints.length < 2) return;

        const geometry = new THREE.BufferGeometry().setFromPoints(this.currentDrawPoints);
        const material = new THREE.LineBasicMaterial({ color: 0x00f2ff });
        this.previewLine = new THREE.Line(geometry, material);
        this.scene.add(this.previewLine);
    }

    check2DStatus() {
        if (this.currentDrawPoints.length < 5) return;

        // Simple heuristic: check if spread in one dimension is very small
        const min = new THREE.Vector3(Infinity, Infinity, Infinity);
        const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

        this.currentDrawPoints.forEach(p => {
            min.min(p);
            max.max(p);
        });

        const size = new THREE.Vector3().subVectors(max, min);
        if (size.x < 0.1 || size.y < 0.1 || size.z < 0.1) {
            this.showNotification("Great now it's time to make the design 3D!");
        }
    }

    shapeify() {
        if (this.currentDrawPoints.length < 2) {
            this.showNotification("Draw something first!");
            return;
        }

        // Create a tube from the points
        const curve = new THREE.CatmullRomCurve3(this.currentDrawPoints);
        const geometry = new THREE.TubeGeometry(curve, 64, 0.1, 8, false);
        const material = new THREE.MeshStandardMaterial({ color: 0xff00ff });
        const mesh = new THREE.Mesh(geometry, material);

        this.scene.add(mesh);
        this.meshes.push(mesh);

        this.scene.remove(this.previewLine);
        this.previewLine = null;
        this.storeLastCarve('shapeify', { points: [...this.currentDrawPoints] });
        this.currentDrawPoints = [];
    }

    startCircleDraw(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Use ground plane (y=0) for center if nothing hit
        const intersects = this.raycaster.intersectObjects(this.meshes);
        if (intersects.length > 0) {
            this.circleCenter = intersects[0].point;
        } else {
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const target = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(plane, target);
            this.circleCenter = target;
        }

        // Create preview circle
        const geom = new THREE.TorusGeometry(0.1, 0.02, 16, 100);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.5 });
        this.circlePreview = new THREE.Mesh(geom, mat);
        this.circlePreview.position.copy(this.circleCenter);
        this.circlePreview.rotateX(Math.PI / 2);
        this.scene.add(this.circlePreview);
        this.controls.enabled = false;
    }

    updateCircleDraw(event) {
        if (!this.circleCenter || !this.circlePreview) return;

        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.circleCenter.y);
        const target = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(plane, target);

        const radius = this.circleCenter.distanceTo(target);
        if (radius > 0.01) {
            this.circlePreview.geometry.dispose();
            this.circlePreview.geometry = new THREE.TorusGeometry(radius, 0.05, 16, 100);
        }
    }

    finishCircleDraw() {
        if (!this.circlePreview) return;

        const radius = this.circlePreview.geometry.parameters.radius;
        const position = this.circlePreview.position.clone();

        this.scene.remove(this.circlePreview);
        this.circlePreview = null;
        this.circleCenter = null;
        this.controls.enabled = true;

        if (radius > 0.1) {
            const geometry = new THREE.TorusGeometry(radius, 0.05, 16, 100);
            const material = new THREE.MeshStandardMaterial({
                color: 0x00f2ff,
                transparent: true,
                opacity: 0.8,
                metalness: 0.5,
                roughness: 0.2
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(position);
            mesh.rotateX(Math.PI / 2);

            this.scene.add(mesh);
            this.meshes.push(mesh);
            this.showNotification("Perfect circle design created!");
            this.storeLastCarve('circlePrimitive', { position: mesh.position.clone(), radius });
        }
    }

    handleSelection(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.meshes);

        if (intersects.length > 0) {
            this.transformControls.setMode('translate');
            this.transformControls.attach(intersects[0].object);
            this.updateDeleteButtonText();
        } else if (!this.transformControls.dragging) {
            this.transformControls.detach();
            this.updateDeleteButtonText();
        }
    }

    handleCarve(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.meshes);

        if (intersects.length > 0) {
            const hit = intersects[0].object;
            const point = intersects[0].point;

            if (this.isStraight) {
                // For "straight lines in carving", we'll do a simple vertical cut at the clicked point
                // with a normal relative to the view or simply X/Z based.
                // We'll use the camera orientation to decide the cut plane.
                const normal = new THREE.Vector3();
                this.camera.getWorldDirection(normal);
                normal.y = 0; // Vertical plane
                normal.normalize();
                this.splitMeshCustom(hit, point, normal);
            } else {
                // Default horizontal split
                this.splitMesh(hit, point);
            }
        }
    }

    splitMeshCustom(mesh, point, normal) {
        const index = this.meshes.indexOf(mesh);
        if (index > -1) this.meshes.splice(index, 1);
        this.scene.remove(mesh);

        const createClipped = (side) => {
            const geom = mesh.geometry.clone();
            const mat = mesh.material.clone();

            const planeNormal = normal.clone().multiplyScalar(side);
            // d = -n . p
            const constant = -planeNormal.dot(point);
            const plane = new THREE.Plane(planeNormal, constant);

            mat.clippingPlanes = [plane];
            this.renderer.localClippingEnabled = true;

            const m = new THREE.Mesh(geom, mat);
            m.position.copy(mesh.position);
            m.quaternion.copy(mesh.quaternion);
            m.scale.copy(mesh.scale);

            // Visual offset
            const offset = normal.clone().multiplyScalar(side * 0.2);
            m.position.add(offset);

            this.scene.add(m);
            this.meshes.push(m);
        };

        createClipped(1);
        createClipped(-1);
        this.showNotification("Shape carved with a straight line!");
        this.storeLastCarve('splitCustom', { mesh, point, normal });
    }

    handleScale(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        // Important: Ignore transform controls itself when clicking
        const intersects = this.raycaster.intersectObjects(this.meshes);

        if (intersects.length > 0) {
            this.transformControls.setMode('scale');
            this.transformControls.setTranslationSnap(null);
            this.transformControls.setRotationSnap(null);
            this.transformControls.setScaleSnap(null);
            this.transformControls.attach(intersects[0].object);
            this.showNotification("Drag the X, Y, or Z handles to make it shorter or fatter!");
        } else if (!this.transformControls.dragging) {
            this.transformControls.detach();
        }
    }

    handleBend(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.meshes);

        if (intersects.length > 0) {
            const mesh = intersects[0].object;
            this.applyBend(mesh);
        }
    }

    applyBend(mesh) {
        // Simple bend implementation: curve along the X axis
        const geometry = mesh.geometry;
        if (!geometry.attributes.position) return;

        const position = geometry.attributes.position;
        const bendFactor = 0.5; // Fixed bend for now, could be dynamic

        // Ensure geometry is centered or we bend relative to the origin
        mesh.updateMatrixWorld();

        for (let i = 0; i < position.count; i++) {
            let x = position.getX(i);
            let y = position.getY(i);
            let z = position.getZ(i);

            // Bend formula: higher X means more rotation around Z
            const angle = x * bendFactor;
            const newX = Math.sin(angle) * (1 / bendFactor + y);
            const newY = Math.cos(angle) * (1 / bendFactor + y) - 1 / bendFactor;

            position.setXY(i, newX, newY);
        }

        position.needsUpdate = true;
        geometry.computeVertexNormals();
        this.showNotification("Shape curved and bent!");
    }

    finishSketchCarve() {
        if (this.currentDrawPoints.length < 3) {
            this.showNotification("Draw a more complex shape to carve!");
            this.scene.remove(this.previewLine);
            this.previewLine = null;
            this.currentDrawPoints = [];
            return;
        }

        // 1. Coordinate system based on camera
        const cameraDir = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDir);
        const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        const cameraRight = new THREE.Vector3().crossVectors(cameraDir, cameraUp).normalize();

        // 2. Project points to create 2D shape
        const origin = this.currentDrawPoints[0];
        const shapePoints = this.currentDrawPoints.map(p => {
            const rel = new THREE.Vector3().subVectors(p, origin);
            return new THREE.Vector2(rel.dot(cameraRight), rel.dot(cameraUp));
        });

        const center = new THREE.Vector3();
        this.currentDrawPoints.forEach(p => center.add(p));
        center.divideScalar(this.currentDrawPoints.length);

        if (this.applySketchCarveAt(shapePoints, center, cameraDir)) {
            this.showNotification("Custom shape carved successfully!");
            this.storeLastCarve('sketchCarve', { points: shapePoints, center: center.clone(), cameraDir: cameraDir.clone() });
        } else {
            this.showNotification("Sketch didn't intersect any design.");
        }

        this.scene.remove(this.previewLine);
        this.previewLine = null;
        this.currentDrawPoints = [];
    }

    applySketchCarveAt(shapePoints, center, direction) {
        const shape = new THREE.Shape(shapePoints);
        const extrudeSettings = { depth: 20, bevelEnabled: false };
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.center();

        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const cutterBrush = new Brush(geometry, material);

        cutterBrush.position.copy(center);
        cutterBrush.lookAt(center.clone().add(direction));
        cutterBrush.updateMatrixWorld();

        const evaluator = new Evaluator();
        let carvedSomething = false;

        const targets = [...this.meshes];
        for (const mesh of targets) {
            const targetBrush = new Brush(mesh.geometry, mesh.material);
            targetBrush.position.copy(mesh.position);
            targetBrush.quaternion.copy(mesh.quaternion);
            targetBrush.scale.copy(mesh.scale);
            targetBrush.updateMatrixWorld();

            if (evaluator.evaluate(targetBrush, cutterBrush, INTERSECTION).geometry.attributes.position.count > 0) {
                const resultBrush = evaluator.evaluate(targetBrush, cutterBrush, SUBTRACTION);

                const index = this.meshes.indexOf(mesh);
                if (index > -1) this.meshes.splice(index, 1);
                this.scene.remove(mesh);

                const resultMesh = new THREE.Mesh(resultBrush.geometry, mesh.material);
                this.meshes.push(resultMesh);
                this.scene.add(resultMesh);
                carvedSomething = true;
            }
        }
        return carvedSomething;
    }

    handleCircleCarve(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.meshes);

        if (intersects.length > 0) {
            const hit = intersects[0].object;
            const point = intersects[0].point;
            this.punchHole(hit, point);
        }
    }

    punchHole(mesh, point) {
        // CSG Boolean Subtraction
        const evaluator = new Evaluator();
        const targetBrush = new Brush(mesh.geometry, mesh.material);
        targetBrush.position.copy(mesh.position);
        targetBrush.quaternion.copy(mesh.quaternion);
        targetBrush.scale.copy(mesh.scale);
        targetBrush.updateMatrixWorld();

        // Create a cylinder to act as the circular cutter
        const cutterGeom = new THREE.CylinderGeometry(0.3, 0.3, 5, 32);
        const cutterMat = new THREE.MeshStandardMaterial();
        const cutterBrush = new Brush(cutterGeom, cutterMat);

        // Orient cutter to look at camera (punch "through" from view)
        cutterBrush.position.copy(point);
        cutterBrush.lookAt(this.camera.position);
        cutterBrush.rotateX(Math.PI / 2); // Align cylinder axis with view line
        cutterBrush.updateMatrixWorld();

        const resultBrush = evaluator.evaluate(targetBrush, cutterBrush, SUBTRACTION);

        // Update scene
        const index = this.meshes.indexOf(mesh);
        if (index > -1) this.meshes.splice(index, 1);
        this.scene.remove(mesh);

        const resultMesh = new THREE.Mesh(resultBrush.geometry, mesh.material);
        this.meshes.push(resultMesh);
        this.scene.add(resultMesh);

        this.showNotification("Perfect circular hole carved!");
        this.storeLastCarve('punchHole', { mesh, point, cameraPos: this.camera.position.clone() });
    }

    storeLastCarve(type, params) {
        this.lastCarve = { type, params };
        this.showRepeatOptions('choices');
        document.getElementById('repeat-carve-prompt').classList.remove('hidden');

        // As per user request: "leave the 3d repeated sketching as is"
        // If it's a drawing/primitive, we can optionally hide the "Equally Apart" button 
        // to keep it focused on carving.
        const isCarve = ['split', 'splitCustom', 'punchHole', 'sketchCarve'].includes(type);
        document.getElementById('btn-repeat-equal-mode').style.display = isCarve ? 'inline-block' : 'none';
        document.getElementById('repeat-title').innerText = isCarve ? "Repeat last carve?" : "Repeat last shape?";
    }

    showRepeatOptions(mode) {
        document.getElementById('repeat-choices').classList.add('hidden');
        document.getElementById('repeat-normal-options').classList.add('hidden');
        document.getElementById('repeat-equal-options').classList.add('hidden');

        if (mode === 'choices') {
            document.getElementById('repeat-choices').classList.remove('hidden');
        } else if (mode === 'normal') {
            document.getElementById('repeat-normal-options').classList.remove('hidden');
        } else if (mode === 'equal') {
            document.getElementById('repeat-equal-options').classList.remove('hidden');
        }
    }

    hideRepeatPrompt() {
        document.getElementById('repeat-carve-prompt').classList.add('hidden');
    }

    async repeatMultiCarve() {
        if (!this.lastCarve) return;

        const count = parseInt(document.getElementById('repeat-count').value) || 1;
        const distance = parseFloat(document.getElementById('repeat-distance-equal').value) || 1;

        this.hideRepeatPrompt();
        this.showNotification(`Applying ${count} repeated carves...`);

        // We will perform the 'Normal' repeat 'count' times in a loop.
        for (let i = 0; i < count; i++) {
            // We temporarily set the single-repeat distance input so repeatLastCarve uses it
            const singleInput = document.getElementById('repeat-distance');
            const oldVal = singleInput.value;
            singleInput.value = distance;

            this.repeatLastCarve();

            singleInput.value = oldVal;

            // Small delay to allow for visual feedback or CSG processing
            await new Promise(r => setTimeout(r, 200));
        }
        this.showNotification(`Finished ${count} repeated carves!`);
    }

    repeatLastCarve() {
        if (!this.lastCarve) return;

        const distance = parseFloat(document.getElementById('repeat-distance').value) || 1;
        const { type, params } = this.lastCarve;

        // Find which mesh(es) to carve now. 
        // We look for any mesh that intersects with the offset point.
        let offsetPoint;
        let normal;

        if (type === 'split') {
            normal = new THREE.Vector3(0, 1, 0);
            offsetPoint = params.point.clone().add(normal.clone().multiplyScalar(distance));
        } else if (type === 'splitCustom') {
            normal = params.normal;
            offsetPoint = params.point.clone().add(normal.clone().multiplyScalar(distance));
        } else if (type === 'punchHole') {
            // For circular, "after" is a bit ambiguous, but we'll assume a direction relative to the punch
            // or just use the camera direction that made the punch.
            const direction = new THREE.Vector3().subVectors(params.point, params.cameraPos).normalize();
            // Actually, "centimetres after" likely means a translation in the plane of the design.
            // Let's assume a horizontal/view-based offset for now.
            const viewRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
            offsetPoint = params.point.clone().add(viewRight.multiplyScalar(distance));
        } else if (type === 'shapeify') {
            // Repeat the tube at an offset
            const viewRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
            const offsetPoints = params.points.map(p => p.clone().add(viewRight.clone().multiplyScalar(distance)));

            const curve = new THREE.CatmullRomCurve3(offsetPoints);
            const geometry = new THREE.TubeGeometry(curve, 64, 0.1, 8, false);
            const material = new THREE.MeshStandardMaterial({ color: 0xff00ff });
            const mesh = new THREE.Mesh(geometry, material);

            this.scene.add(mesh);
            this.meshes.push(mesh);

            this.showNotification(`Drawn shape repeated ${distance}cm away!`);
            // Update last carve points for chaining
            this.lastCarve.params.points = offsetPoints;
            return;
        } else if (type === 'circlePrimitive') {
            const viewRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
            const offsetPos = params.position.clone().add(viewRight.multiplyScalar(distance));

            this.addPrimitive('circle', offsetPos);
            this.showNotification(`Circle repeated ${distance}cm away!`);
            // Chaining is handled by addPrimitive calling storeLastCarve with the new position
            return;
        } else if (type === 'ringPrimitive') {
            const viewRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
            const offsetPos = params.position.clone().add(viewRight.multiplyScalar(distance));

            this.addPrimitive('ring', offsetPos);
            this.showNotification(`Ring repeated ${distance}cm away!`);
            return;
        } else if (type === 'sketchCarve') {
            const viewRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
            const offsetCenter = params.center.clone().add(viewRight.multiplyScalar(distance));

            if (this.applySketchCarveAt(params.points, offsetCenter, params.cameraDir)) {
                this.showNotification(`Sketch carve repeated ${distance}cm away!`);
            } else {
                this.showNotification("Repeated sketch didn't intersect any design.");
            }
            this.lastCarve.params.center = offsetCenter;
            return;
        }

        // Try to find a mesh at the offset point
        const ray = new THREE.Ray(offsetPoint.clone().add(new THREE.Vector3(0, 10, 0)), new THREE.Vector3(0, -1, 0));
        this.raycaster.ray.copy(ray);
        const intersects = this.raycaster.intersectObjects(this.meshes);

        if (intersects.length > 0) {
            const hit = intersects[0].object;
            if (type === 'split') this.splitMesh(hit, offsetPoint);
            else if (type === 'splitCustom') this.splitMeshCustom(hit, offsetPoint, params.normal);
            else if (type === 'punchHole') {
                const oldCamPos = this.camera.position.clone();
                this.camera.position.copy(params.cameraPos);
                this.punchHole(hit, offsetPoint);
                this.camera.position.copy(oldCamPos);
            }
            this.showNotification(`Carve repeated ${distance}cm away!`);
        } else {
            this.showNotification("Could not find a design at the offset distance.");
        }

        // Update last carve point for chaining
        this.lastCarve.params.point = offsetPoint;
    }

    mergeAll() {
        if (this.meshes.length < 2) {
            this.showNotification("At least two designs needed to connect.");
            return;
        }

        const geometries = [];
        this.meshes.forEach(m => {
            m.updateMatrixWorld();
            const clone = m.geometry.clone();
            clone.applyMatrix4(m.matrixWorld);
            geometries.push(clone);
            this.scene.remove(m);
        });

        const mergedGeom = BufferGeometryUtils.mergeGeometries(geometries);
        const material = new THREE.MeshStandardMaterial({
            color: 0x00f2ff,
            transparent: true,
            opacity: 0.8,
            metalness: 0.5,
            roughness: 0.2
        });
        const mergedMesh = new THREE.Mesh(mergedGeom, material);

        this.meshes = [mergedMesh];
        this.scene.add(mergedMesh);
        this.transformControls.detach();

        this.showNotification("Designs connected into a single object!");
    }

    splitMesh(mesh, point) {
        // Find index and remove
        const index = this.meshes.indexOf(mesh);
        if (index > -1) this.meshes.splice(index, 1);
        this.scene.remove(mesh);

        // Define a split plane (using the click point and a default normal)
        const planeNormal = new THREE.Vector3(0, 1, 0); // Horizontal split for simplicity

        // Helper to create a partial mesh using clipping planes
        const createClipped = (side) => {
            const geom = mesh.geometry.clone();
            const mat = mesh.material.clone();

            // Clipping plane logic
            const plane = new THREE.Plane(planeNormal.clone().multiplyScalar(side), side > 0 ? -point.y : point.y);
            mat.clippingPlanes = [plane];
            this.renderer.localClippingEnabled = true;

            const m = new THREE.Mesh(geom, mat);
            m.position.copy(mesh.position);
            // Offset a bit to show split
            m.position.y += side * 0.2;

            this.scene.add(m);
            this.meshes.push(m);
        };

        createClipped(1);  // Top half
        createClipped(-1); // Bottom half

        this.showNotification("Shape carved and split into two!");
        this.storeLastCarve('split', { mesh, point });
    }

    exportDesign() {
        const exporter = new STLExporter();
        const options = { binary: true };

        // Collect all meshes in the scene
        const result = exporter.parse(this.scene, options);

        const blob = new Blob([result], { type: 'application/octet-stream' });
        const link = document.createElement('a');
        link.style.display = 'none';
        document.body.appendChild(link);

        link.href = URL.createObjectURL(blob);
        link.download = 'my-3d-design.stl';
        link.click();

        this.showNotification("STL file exported successfully!");
    }

    showNotification(text) {
        const area = document.getElementById('notification-area');
        area.innerText = text;
        area.classList.add('show');
        setTimeout(() => area.classList.remove('show'), 4000);
    }

    onKeyDown(event) {
        if (event.key === 'Escape') {
            const selectBtn = document.getElementById('id-btn-select');
            this.toggleTool('select', selectBtn);
            this.showNotification("Mode canceled. Selection active.");
        }
        if (event.code === 'Delete' || event.code === 'Backspace') {
            // Only delete if not typing in a project name or number input
            if (document.activeElement.tagName !== 'INPUT') {
                this.deleteSelectedShape();
            }
        }
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

new App();
