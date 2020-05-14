import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    Clock,
    PointLight,
    TorusGeometry,
    Mesh,
    BufferAttribute,
    InstancedBufferGeometry,
    InstancedInterleavedBuffer,
    InterleavedBufferAttribute,
  } from "https://cdn.jsdelivr.net/npm/three@0.115.0/src/Three.js";
  import {
    ColorNode,
    PositionNode,
    OperatorNode,
    SwitchNode,
    NodeFrame,
    AttributeNode,
  } from "https://cdn.jsdelivr.net/npm/three@0.115.0/examples/jsm/nodes/Nodes.js";
  import { StandardNodeMaterial } from "https://codepen.io/teropa/pen/PoPdYOr.js";
  import { tessellateTriangle } from "https://unpkg.com/@teropa/triangle-tessellation@1.1.0/dist/index.esm.js";
  
  // how many levels of subdivision to generate
  const MAX_SUBDIVISIONS = 10;
  const SUBDIVISION_NEIGHBOURHOOD = 3;
  
  let scene = new Scene();
  let camera = new PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 5;
  let renderer = new WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  
  let clock = new Clock();
  let frame = new NodeFrame();
  frame.setRenderer(renderer);
  
  let pointLightFront = new PointLight();
  pointLightFront.position.z = 5;
  pointLightFront.position.x = 3;
  scene.add(pointLightFront);
  let pointLightBack = new PointLight();
  pointLightBack.position.z = -5;
  pointLightBack.position.x = -3;
  scene.add(pointLightBack);
  
  let stats = new Stats();
  stats.showPanel(0);
  document.body.appendChild(stats.dom);
  
  // The coarse geometry we will be tessellating
  let coarseGeometry = new TorusGeometry(2.5, 1, 16, 25);
  
  function subdivideTriangle(triangle, uLevels, vLevels, wLevels) {
    // Tessellate using https://www.npmjs.com/package/@teropa/triangle-tessellation
    return tessellateTriangle(
      triangle,
      Math.max(uLevels, vLevels) + 1,
      Math.max(vLevels, wLevels) + 1,
      Math.max(wLevels, uLevels) + 1,
      (uLevels + vLevels + wLevels) / 3 + 1
    );
  }
  
  function generateSubdivision(uDepth, vDepth, wDepth) {
    // Subdivide a a triangle in barycentric coordinates to the given depths
    let patch = subdivideTriangle(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      uDepth,
      vDepth,
      wDepth
    );
    return {
      vertices: new Float32Array(
        patch.vertices.reduce((arr, v) => [...arr, ...v], [])
      ),
      faces: patch.faces.reduce((arr, f) => [...arr, ...f], []),
    };
  }
  
  // The vertex positions and normals of the coarse geometry pulled from buffer attributes.
  // These represent the three extremities of each triangle in the coarse mesh.
  let p0Input = new AttributeNode("p0", 3);
  let p1Input = new AttributeNode("p1", 3);
  let p2Input = new AttributeNode("p2", 3);
  let n0Input = new AttributeNode("n0", 3);
  let n1Input = new AttributeNode("n1", 3);
  let n2Input = new AttributeNode("n2", 3);
  
  // The position of each point in the refinement pattern, in barycentric coordinates, pulled from the vertex position
  let barycentricPosition = new PositionNode(PositionNode.LOCAL);
  let uNode = new SwitchNode(barycentricPosition, "y");
  let vNode = new SwitchNode(barycentricPosition, "z");
  let wNode = new SwitchNode(barycentricPosition, "x");
  
  // Barycentric interpolation of the coarse mesh positions and normals to each point in the refinement pattern
  let worldPosition = new OperatorNode(
    new OperatorNode(p0Input, wNode, OperatorNode.MUL),
    new OperatorNode(
      new OperatorNode(p1Input, uNode, OperatorNode.MUL),
      new OperatorNode(p2Input, vNode, OperatorNode.MUL),
      OperatorNode.ADD
    ),
    OperatorNode.ADD
  );
  let worldNormal = new OperatorNode(
    new OperatorNode(n0Input, wNode, OperatorNode.MUL),
    new OperatorNode(
      new OperatorNode(n1Input, uNode, OperatorNode.MUL),
      new OperatorNode(n2Input, vNode, OperatorNode.MUL),
      OperatorNode.ADD
    ),
    OperatorNode.ADD
  );
  
  let material = new StandardNodeMaterial();
  material.wireframe = true;
  material.color = new ColorNode(0x00ff00);
  material.position = worldPosition; // Final vertex position based on the interpolation
  material.objectNormal = worldNormal; // Final vertex normal based on the interpolation
  
  // Build a single Float32Array for the vertex positions and normals of the coarse geometry.
  // One triangle face at a time, stride 3 * (3 positions + 3 normals)
  let geometryData = new Float32Array(coarseGeometry.faces.length * 3 * 6);
  for (let i = 0; i < coarseGeometry.faces.length; i++) {
    let coarseFace = coarseGeometry.faces[i];
    let stride = i * 3 * 6;
    geometryData.set(coarseGeometry.vertices[coarseFace.a].toArray(), stride);
    geometryData.set(coarseGeometry.vertices[coarseFace.b].toArray(), stride + 3);
    geometryData.set(coarseGeometry.vertices[coarseFace.c].toArray(), stride + 6);
    geometryData.set(coarseFace.vertexNormals[0].toArray(), stride + 9);
    geometryData.set(coarseFace.vertexNormals[1].toArray(), stride + 12);
    geometryData.set(coarseFace.vertexNormals[2].toArray(), stride + 15);
  }
  
  // Build an instanced buffer geometry for each possible subdivision depth.
  // We do this by looping the depths of each of the three vertices of a triangle, and for each combination
  // of three vertex depths, generating a triangle tessellation for those depths.
  let geometries = [],
    buffers = [];
  for (let u = 0; u < MAX_SUBDIVISIONS; u++) {
    geometries[u] = [];
    buffers[u] = [];
    for (
      let v = Math.max(u - SUBDIVISION_NEIGHBOURHOOD, 0);
      v < Math.min(u + SUBDIVISION_NEIGHBOURHOOD, MAX_SUBDIVISIONS);
      v++
    ) {
      geometries[u][v] = [];
      buffers[u][v] = [];
      for (
        let w = Math.max(v - SUBDIVISION_NEIGHBOURHOOD, 0);
        w < Math.min(v + SUBDIVISION_NEIGHBOURHOOD, MAX_SUBDIVISIONS);
        w++
      ) {
        // Get the tessellated, barycentric vertices and faces
        let { vertices, faces } = generateSubdivision(u, v, w);
  
        // Build the Three.js instanced geometry for these vertices and faces
        let geometry = new InstancedBufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(vertices, 3));
        geometry.setIndex(faces);
  
        // Create buffer attributes to hold the positions and normals of the coarse triangles that
        // will be assigned to this particular refinement depth. We initialise a single interleaved buffer
        // that has room for potentially the whole coarse geometry, but is empty. Coarse triangles are populated
        // in it in the animation loop.
        let buffer = new InstancedInterleavedBuffer(
          new Float32Array(coarseGeometry.faces.length * 3 * 6),
          3 * 6
        );
        geometry.setAttribute("p0", new InterleavedBufferAttribute(buffer, 3, 0));
        geometry.setAttribute("p1", new InterleavedBufferAttribute(buffer, 3, 3));
        geometry.setAttribute("p2", new InterleavedBufferAttribute(buffer, 3, 6));
        geometry.setAttribute("n0", new InterleavedBufferAttribute(buffer, 3, 9));
        geometry.setAttribute("n1", new InterleavedBufferAttribute(buffer, 3, 12));
        geometry.setAttribute("n2", new InterleavedBufferAttribute(buffer, 3, 15));
  
        // Add a Mesh to the scene for this refinement pattern
        let mesh = new Mesh(geometry, material);
        scene.add(mesh);
  
        geometries[u][v][w] = geometry;
        buffers[u][v][w] = buffer;
      }
    }
  }
  
  // The animation loop
  let animate = () => {
    requestAnimationFrame(animate);
    stats.begin();
  
    // Update the refinement patterns
    assignGeometries(clock.elapsedTime);
  
    // Three.js Node material update
    frame.update(clock.getDelta());
    frame.updateNode(material);
  
    // Camera movement
    let angle = clock.elapsedTime * 0.5;
    camera.position.x = 5 * Math.cos(angle);
    camera.position.z = 5 * Math.sin(angle);
    camera.lookAt(0, 0, 0);
  
    renderer.render(scene, camera);
    stats.end();
  };
  
  // Per-frame gometry update
  function assignGeometries(time) {
    // Initialise the instance counts of all refinement patterns to zero
    for (let u = 0; u < MAX_SUBDIVISIONS; u++) {
      for (
        let v = Math.max(u - SUBDIVISION_NEIGHBOURHOOD, 0);
        v < Math.min(u + SUBDIVISION_NEIGHBOURHOOD, MAX_SUBDIVISIONS);
        v++
      ) {
        for (
          let w = Math.max(v - SUBDIVISION_NEIGHBOURHOOD, 0);
          w < Math.min(v + SUBDIVISION_NEIGHBOURHOOD, MAX_SUBDIVISIONS);
          w++
        ) {
          geometries[u][v][w].maxInstancedCount = 0;
        }
      }
    }
  
    // Walk through the triangle faces of the coarse geometry
    for (let faceIdx = 0; faceIdx < coarseGeometry.faces.length; faceIdx++) {
      let { a, b, c } = coarseGeometry.faces[faceIdx];
  
      // Calculate what depth this triangle should be refined to at this time
      let u = getDivisionDepth(coarseGeometry.vertices[a], time);
      let v = getDivisionDepth(coarseGeometry.vertices[b], time);
      let w = getDivisionDepth(coarseGeometry.vertices[c], time);
  
      // Assign this coarse triangle's geometry (three positions and three normals) to the buffer attribute
      // of the refinement pattern at the calculated depth, and increase its instance count.
      let dataStride = faceIdx * 3 * 6;
      buffers[u][v][w].set(
        geometryData.subarray(dataStride, dataStride + 3 * 6),
        geometries[u][v][w].maxInstancedCount * 3 * 6
      );
      geometries[u][v][w].maxInstancedCount += 1;
      buffers[u][v][w].needsUpdate = true;
    }
  }
  
  // Calculate the refinement depth of a vertex, in a angle rotational pattern over time
  function getDivisionDepth(vertex, time) {
    let angle = Math.atan2(vertex.y, vertex.x);
    return Math.floor(
      (Math.sin(angle + time * 10) / 2 + 0.5) * (MAX_SUBDIVISIONS - 1)
    );
  }
  
  window.addEventListener( 'resize', onWindowResize, false );
  function onWindowResize(){
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize( window.innerWidth, window.innerHeight );
  }
  
  animate();