var glMat4 = require('gl-mat4')
var glMat3 = require('gl-mat3')
var glVec3 = require('gl-vec3')
var expandVertexData = require('expand-vertex-data')
var animationSystem = require('skeletal-animation-system')
var mat4ToDualQuat = require('mat4-to-dual-quat')

var baseballPlayer = require('./cowboy.json')
baseballPlayer = expandVertexData(baseballPlayer)
baseballPlayer.keyframes = require('./cowboy.json').keyframes

var canvas = document.createElement('canvas')
canvas.width = 500
canvas.height = 500
var mountLocation = document.getElementById('webgl-skeletal-sound-tutorial') || document.body
mountLocation.appendChild(canvas)

var isDragging = false
var xCamRot = Math.PI / 20
var yCamRot = 0
var lastX
var lastY
canvas.onmousedown = function (e) {
  isDragging = true
  lastX = e.pageX
  lastY = e.pageY
}
canvas.onmouseup = function () {
  isDragging = false
}
canvas.onmousemove = function (e) {
  if (isDragging) {
    xCamRot += (e.pageY - lastY) / 60
    yCamRot -= (e.pageX - lastX) / 60

    xCamRot = Math.min(xCamRot, Math.PI / 2.5)
    xCamRot = Math.max(-0.5, xCamRot)

    lastX = e.pageX
    lastY = e.pageY
  }
}

var gl = canvas.getContext('webgl')
gl.clearColor(0.0, 0.0, 0.0, 1.0)
gl.enable(gl.DEPTH_TEST)

var vertexGLSL = `
attribute vec3 aVertexPosition;
attribute vec3 aVertexNormal;

attribute vec4 aJointIndex;
attribute vec4 aJointWeight;

varying vec3 vNormal;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform mat3 uNMatrix;

// TODO: Generate this shader at runtime with proper num joints
// TODO: Stopped working on mobile when we had a combined array length of > a few dozen
// TODO: Variable
uniform vec4 boneRotQuaternions[18];
uniform vec4 boneTransQuaternions[18];

varying vec3 vLightWeighting;
varying vec3 vNormmal;

void main (void) {
  // Blend our dual quaternion
  vec4 weightedRotQuats = boneRotQuaternions[int(aJointIndex.x)] * aJointWeight.x +
    boneRotQuaternions[int(aJointIndex.y)] * aJointWeight.y +
    boneRotQuaternions[int(aJointIndex.z)] * aJointWeight.z +
    boneRotQuaternions[int(aJointIndex.w)] * aJointWeight.w;

  vec4 weightedTransQuats = boneTransQuaternions[int(aJointIndex.x)] * aJointWeight.x +
    boneTransQuaternions[int(aJointIndex.y)] * aJointWeight.y +
    boneTransQuaternions[int(aJointIndex.z)] * aJointWeight.z +
    boneTransQuaternions[int(aJointIndex.w)] * aJointWeight.w;

  // Normalize our dual quaternion (necessary for nlerp)
  float xRot = weightedRotQuats[0];
  float yRot = weightedRotQuats[1];
  float zRot = weightedRotQuats[2];
  float wRot = weightedRotQuats[3];
  float magnitude = sqrt(xRot * xRot + yRot * yRot + zRot * zRot + wRot * wRot);
  weightedRotQuats = weightedRotQuats / magnitude;
  weightedTransQuats = weightedTransQuats / magnitude;

  // Convert out dual quaternion in a 4x4 matrix
  //  equation: https://www.cs.utah.edu/~ladislav/kavan07skinning/kavan07skinning.pdf
  float xR = weightedRotQuats[0];
  float yR = weightedRotQuats[1];
  float zR = weightedRotQuats[2];
  float wR = weightedRotQuats[3];

  float xT = weightedTransQuats[0];
  float yT = weightedTransQuats[1];
  float zT = weightedTransQuats[2];
  float wT = weightedTransQuats[3];

  float t0 = 2.0 * (-wT * xR + xT * wR - yT * zR + zT * yR);
  float t1 = 2.0 * (-wT * yR + xT * zR + yT * wR - zT * xR);
  float t2 = 2.0 * (-wT * zR - xT * yR + yT * xR + zT * wR);

  mat4 convertedMatrix = mat4(
      1.0 - (2.0 * yR * yR) - (2.0 * zR * zR),
      (2.0 * xR * yR) + (2.0 * wR * zR),
      (2.0 * xR * zR) - (2.0 * wR * yR),
      0,
      (2.0 * xR * yR) - (2.0 * wR * zR),
      1.0 - (2.0 * xR * xR) - (2.0 * zR * zR),
      (2.0 * yR * zR) + (2.0 * wR * xR),
      0,
      (2.0 * xR * zR) + (2.0 * wR * yR),
      (2.0 * yR * zR) - (2.0 * wR * xR),
      1.0 - (2.0 * xR * xR) - (2.0 * yR * yR),
      0,
      t0,
      t1,
      t2,
      1
      );

  // Transform our normal using our blended transformation matrix.
  // We do not need to take the inverse transpose here since dual quaternions
  // guarantee that we have a rigid transformation matrix.

  // In other words, we know for a fact that there is no scale or shear,
  // so we do not need to create an inverse transpose matrix to account for scale and shear
  vec3 transformedNormal = (convertedMatrix * vec4(aVertexNormal, 0.0)).xyz;

  // Swap our normal's y and z axis since Blender uses a right handed coordinate system
  float y;
  float z;
  y = transformedNormal.z;
  z = -transformedNormal.y;
  transformedNormal.y = y;
  transformedNormal.z = z;

  // We convert our normal into column major before multiplying it with our normal matrix
  transformedNormal = uNMatrix * transformedNormal;

  // Blender uses a right handed coordinate system. We convert to left handed here
  vec4 leftWorldSpace = convertedMatrix * vec4(aVertexPosition, 1.0);
  y = leftWorldSpace.z;
  z = -leftWorldSpace.y;
  leftWorldSpace.y = y;
  leftWorldSpace.z = z;

  // TODO: Is that even called world space?
  vec4 leftHandedPosition = uPMatrix * uMVMatrix * leftWorldSpace;

  // We only have one index right now... so the weight is always 1.
  gl_Position = leftHandedPosition;

  vNormal = transformedNormal;
}
`

var fragmentGLSL = `
precision mediump float;

varying vec3 vLightWeighting;
varying vec3 vNormal;

uniform vec3 uAmbientColor;
uniform vec3 uDirectionalColor;
uniform vec3 uLightingDirection;

void main(void) {
  // TODO: Phong
  float directionalLightWeighting = max(dot(vNormal, uLightingDirection), 0.0);
  vec3 lightWeighting = uAmbientColor + uDirectionalColor * directionalLightWeighting;

  vec3 baseColor = vec3(1.0, 1.0, 1.0);
  gl_FragColor = vec4(baseColor * lightWeighting, 1.0);
}
`

var vertexShader = gl.createShader(gl.VERTEX_SHADER, vertexGLSL)
gl.shaderSource(vertexShader, vertexGLSL)
gl.compileShader(vertexShader)
console.log(gl.getShaderInfoLog(vertexShader))

var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER, fragmentGLSL)
gl.shaderSource(fragmentShader, fragmentGLSL)
gl.compileShader(fragmentShader)
console.log(gl.getShaderInfoLog(fragmentShader))

var shaderProgram = gl.createProgram()
gl.attachShader(shaderProgram, vertexShader)
gl.attachShader(shaderProgram, fragmentShader)
gl.linkProgram(shaderProgram)

gl.useProgram(shaderProgram)

var vertexPosAttrib = gl.getAttribLocation(shaderProgram, 'aVertexPosition')
var vertexNormalAttrib = gl.getAttribLocation(shaderProgram, 'aVertexNormal')
var jointIndexAttrib = gl.getAttribLocation(shaderProgram, 'aJointIndex')
var jointWeightAttrib = gl.getAttribLocation(shaderProgram, 'aJointWeight')

gl.enableVertexAttribArray(vertexPosAttrib)
gl.enableVertexAttribArray(vertexNormalAttrib)
gl.enableVertexAttribArray(jointIndexAttrib)
gl.enableVertexAttribArray(jointWeightAttrib)

var ambientColorUni = gl.getUniformLocation(shaderProgram, 'uAmbientColor')
var lightingDirectionUni = gl.getUniformLocation(shaderProgram, 'uLightingDirection')
var directionalColorUni = gl.getUniformLocation(shaderProgram, 'uDirectionalColor')
var mVMatrixUni = gl.getUniformLocation(shaderProgram, 'uMVMatrix')
var pMatrixUni = gl.getUniformLocation(shaderProgram, 'uPMatrix')
var nMatrixUni = gl.getUniformLocation(shaderProgram, 'uNMatrix')

var boneRotQuaternions = {}
var boneTransQuaternions = {}
for (var i = 0; i < 18; i++) {
  boneRotQuaternions[i] = gl.getUniformLocation(shaderProgram, `boneRotQuaternions[${i}]`)
  boneTransQuaternions[i] = gl.getUniformLocation(shaderProgram, `boneTransQuaternions[${i}]`)
}

var vertexPosBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vertexPosBuffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(baseballPlayer.positions), gl.STATIC_DRAW)
gl.vertexAttribPointer(vertexPosAttrib, 3, gl.FLOAT, false, 0, 0)
var maxPosIndex = 0
var maxFoo = 0
baseballPlayer.positionIndices.forEach(function (index, foo) {
  maxPosIndex = Math.max(maxPosIndex, index)
  maxFoo = Math.max(maxFoo, foo)
})

var vertexNormalBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vertexNormalBuffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(baseballPlayer.normals), gl.STATIC_DRAW)
gl.vertexAttribPointer(vertexNormalAttrib, 3, gl.FLOAT, false, 0, 0)

// TODO: This is only 0-4 or so so only need a byte array
// TODO: Rename to joint influencer buffer
var jointIndexBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, jointIndexBuffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(baseballPlayer.jointInfluences), gl.STATIC_DRAW)
gl.vertexAttribPointer(jointIndexAttrib, 4, gl.FLOAT, false, 0, 0)

var jointWeightBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, jointWeightBuffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(baseballPlayer.jointWeights), gl.STATIC_DRAW)
gl.vertexAttribPointer(jointWeightAttrib, 4, gl.FLOAT, false, 0, 0)

var vertexIndexBuffer = gl.createBuffer()
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer)
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(baseballPlayer.positionIndices), gl.STATIC_DRAW)

gl.uniform3fv(ambientColorUni, [0.3, 0.3, 0.3])
var lightingDirection = [1, -1, -1]
// TODO: Why scale? Look up in learningwebgl.com lesson
glVec3.scale(lightingDirection, lightingDirection, -1)
glVec3.normalize(lightingDirection, lightingDirection)

gl.uniform3fv(lightingDirectionUni, lightingDirection)
gl.uniform3fv(directionalColorUni, [0, 1, 1])

gl.uniformMatrix4fv(pMatrixUni, false, glMat4.perspective([], Math.PI / 3, 1, 0.1, 100))

var firstKeyframe = Object.keys(baseballPlayer.keyframes)[0]
baseballPlayer.keyframes = Object.keys(baseballPlayer.keyframes)
.reduce(function (dualQuats, keyframe) {
  dualQuats[keyframe] = []
  for (var k = 0; k < baseballPlayer.keyframes[keyframe].length; k++) {
    dualQuats[keyframe][k] = mat4ToDualQuat(baseballPlayer.keyframes[keyframe][k])
  }
  return dualQuats
}, {})

var clockTime = 0
// var yRotation = 0
var previousLowerKeyframe

var audio = new window.Audio()
audio.crossOrigin = 'anonymous'
audio.src = 'https://dl.dropboxusercontent.com/s/8c9m92u1euqnkaz/GershwinWhiteman-RhapsodyInBluePart1.mp3'
audio.play()

var context = new window.AudioContext()
var analyzer = context.createScriptProcessor(1024, 1, 1)
var source = context.createMediaElementSource(audio)
source.connect(analyzer)
analyzer.connect(context.destination)

var volumeBarContainer = document.createElement('div')
volumeBarContainer.style.display = 'flex'

var volumeBars = []

for (var i = 0; i < 10; i++) {
  var volumeBar = document.createElement('div')
  volumeBar.style.width = '30px'
  volumeBar.style.height = '30px'
  volumeBar.style.border = 'solid #333 1px'
  volumeBar.style.transition = '0.4s ease background-color'
  volumeBars.push(volumeBar)
  volumeBarContainer.appendChild(volumeBar)
}
document.body.appendChild(volumeBarContainer)

analyzer.onaudioprocess = function (e) {
  var out = e.outputBuffer.getChannelData(0)
  var input = e.inputBuffer.getChannelData(0)
  var max = 0

  for (var i = 0; i < input.length; i++) {
    out[i] = input[i]
    max = input[i] > max ? input[i] : max
  }

  var volume = max * 50
  for (var j = 0; j < 10; j++) {
    if (j < volume) {
      volumeBars[j].style.backgroundColor = 'red'
    } else {
      volumeBars[j].style.backgroundColor = 'white'
    }
  }
}

function draw () {
  // yRotation += 0.02
  gl.clear(gl.COLOR_BUFFER_BIT, gl.DEPTH_BUFFER_BIT)

  clockTime += 0.016
  var animationData = animationSystem.interpolateJoints({
    currentTime: clockTime,
    keyframes: baseballPlayer.keyframes,
    jointNums: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 14, 15, 16, 17],
    currentAnimation: {
      startTime: 0,
      range: [6, 17]
    }
  })

  var newLowerKeyframe = animationData.currentAnimationInfo.lowerKeyframeNumber

  if (newLowerKeyframe === 8 && previousLowerKeyframe !== newLowerKeyframe) {
    console.log('playSound')
  }

  previousLowerKeyframe = newLowerKeyframe

  for (var j = 0; j < 18; j++) {
    var rotQuat = animationData.joints[j].slice(0, 4)
    var transQuat = animationData.joints[j].slice(4, 8)

    gl.uniform4fv(boneRotQuaternions[j], rotQuat)
    gl.uniform4fv(boneTransQuaternions[j], transQuat)
  }

  var modelMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  var nMatrix = glMat3.fromMat4([], modelMatrix)

  // glMat4.rotateY(modelMatrix, modelMatrix, yRotation)

  var camera = glMat4.create()
  glMat4.translate(camera, camera, [0, 0, 25])
  var yAxisCameraRot = glMat4.create()
  var xAxisCameraRot = glMat4.create()
  glMat4.rotateX(xAxisCameraRot, xAxisCameraRot, -xCamRot)
  glMat4.rotateY(yAxisCameraRot, yAxisCameraRot, yCamRot)

  glMat4.multiply(camera, xAxisCameraRot, camera)
  glMat4.multiply(camera, yAxisCameraRot, camera)

  glMat4.lookAt(camera, [camera[12], camera[13], camera[14]], [0, 0, 0], [0, 1, 0])

  var mVMatrix = glMat4.multiply([], camera, modelMatrix)

  gl.uniformMatrix3fv(nMatrixUni, false, nMatrix)
  gl.uniformMatrix4fv(mVMatrixUni, false, mVMatrix)

  gl.drawElements(gl.TRIANGLES, baseballPlayer.positionIndices.length, gl.UNSIGNED_SHORT, 0)

  window.requestAnimationFrame(draw)
}
draw()
