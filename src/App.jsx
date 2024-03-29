import { Canvas, useFrame, createPortal, useThree, extend } from "@react-three/fiber";
import { Suspense, useRef, useLayoutEffect, useMemo, useEffect, useState } from "react";
import { OrbitControls, useFBO } from "@react-three/drei";
import {
	AdditiveBlending,
	Color,
	NearestFilter,
	RGBAFormat,
	FloatType,
	DataTexture,
	MathUtils,
	Scene as TScene,
	OrthographicCamera
} from "three";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { ShaderMaterial } from "three";
import palettes from 'nice-color-palettes';
import { useControls, button, folder } from 'leva'
import { curlNoise } from "./shaders/curlNoise";

const getRandomPalette = () => {
	return palettes[Math.floor(Math.random() * palettes.length)];
}
const getRandomColors = () => {
	const palette = [...getRandomPalette()];
	const color1Index = Math.floor(Math.random() * palette.length)
	const color1 = palette[color1Index];
	// avoid getting the same color twice by removing it from the array
	palette.splice(color1Index, 1);
	const color2 = palette[Math.floor(Math.random() * palette.length)];
	return [color1, color2]
}
const fragmentShader = `

	varying vec3 vColor;
	void main() {
		vec3 color = vColor;
		
		// Light point
		// float strength = distance(gl_PointCoord, vec2(0.5));
		// strength = 1.0 - strength;
		// strength = pow(strength, 5.0);

		// Disc
		float strength = distance(gl_PointCoord, vec2(0.5));
		strength = step(0.5, strength);
		strength = 1.0 - strength;
		color =  mix(vec3(0.0), color, strength);
		
		gl_FragColor = vec4(color, 1.0);
	}
`;
const vertexShader = `
	uniform sampler2D uPositions;
	uniform vec3 uInnerColor;
	uniform vec3 uOuterColor;
	uniform float uSelectedAttractor;
	uniform float uParticleSize;
	uniform float uSizeAttenuationMultiplier;

	varying vec3 vColor;


	vec3 oklab_mix( vec3 colA, vec3 colB, float h )
	{
		// https://bottosson.github.io/posts/oklab
		const mat3 kCONEtoLMS = mat3(                
			 0.4121656120,  0.2118591070,  0.0883097947,
			 0.5362752080,  0.6807189584,  0.2818474174,
			 0.0514575653,  0.1074065790,  0.6302613616);
		const mat3 kLMStoCONE = mat3(
			 4.0767245293, -1.2681437731, -0.0041119885,
			-3.3072168827,  2.6093323231, -0.7034763098,
			 0.2307590544, -0.3411344290,  1.7068625689);
						
		// rgb to cone (arg of pow can't be negative)
		vec3 lmsA = pow( kCONEtoLMS*colA, vec3(1.0/3.0) );
		vec3 lmsB = pow( kCONEtoLMS*colB, vec3(1.0/3.0) );
		// lerp
		vec3 lms = mix( lmsA, lmsB, h );
		// gain in the middle (no oaklab anymore, but looks better?)
	 // lms *= 1.0+0.2*h*(1.0-h);
		// cone to rgb
		return kLMStoCONE*(lms*lms*lms);
	}
	

	void main() {
		vec3 pos = texture2D(uPositions, position.xy).xyz;

		vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
		vec4 viewPosition = viewMatrix * modelPosition;
		vec4 projectedPosition = projectionMatrix * viewPosition;

		float distanceColorMultiplier;
		if(uSelectedAttractor == 0.0) {
			distanceColorMultiplier = 0.025;
		}

		if(uSelectedAttractor == 1.0) {
			distanceColorMultiplier = 0.055;
		}

		if(uSelectedAttractor == 2.0) {
			distanceColorMultiplier = 0.15;
		}

		if(uSelectedAttractor == 3.0) {
			distanceColorMultiplier = 0.005;
		}

		if(uSelectedAttractor == 4.0) {
			distanceColorMultiplier = 0.075;
		}

		if(uSelectedAttractor == 5.0) {
			distanceColorMultiplier = 0.1;
		}

		if(uSelectedAttractor == 6.0) {
			distanceColorMultiplier = 0.24;
		}

		if (uSelectedAttractor == 7.0) {
			distanceColorMultiplier = 0.1;
		}

		if (uSelectedAttractor == 8.0) {
			distanceColorMultiplier = 0.04;
		}
		
		if (uSelectedAttractor == 9.0) {
			distanceColorMultiplier = 0.1;
		}

		if (uSelectedAttractor == 10.) {
			distanceColorMultiplier = 0.15;
		}

		if (uSelectedAttractor == 11.) {
			distanceColorMultiplier = 0.05;
		}

		if (uSelectedAttractor == 12.) {
			distanceColorMultiplier = 0.05;
		}
		if (uSelectedAttractor == 14.) {
			distanceColorMultiplier = 0.7;
		}
		
		if (uSelectedAttractor == 15.) {
			distanceColorMultiplier = 0.94;
		}

		if (uSelectedAttractor == 16.) {
			distanceColorMultiplier = 0.94;
		}
		if (uSelectedAttractor == 17.) {
			distanceColorMultiplier = 0.92;
		}

		if (uSelectedAttractor == -1.0) {
			distanceColorMultiplier = 0.01;
		}

		gl_PointSize = uParticleSize;

		// Size attenuation;
		//   gl_PointSize *= step(1.0 - (1.0/64.0), position.x) + 0.1;
		gl_PointSize *= (uSizeAttenuationMultiplier / - viewPosition.z);
  
		gl_PointSize = max(1., gl_PointSize);
		gl_Position = projectedPosition;

		float dist = distance(pos, vec3(.0));
		vColor = oklab_mix(uInnerColor, uOuterColor, dist * distanceColorMultiplier);

	}

`;

const simulationFragmentShader = `
	precision highp float;

	uniform float attractor;
	uniform float uCurlIntensity;
	uniform float uCurlAmplitude;
	uniform sampler2D positions;

	uniform float uA;
	uniform float uB;
	uniform float uC;
	uniform float uD;
	uniform float uE;
	uniform float uF;

	varying vec2 vUv;
	const float PI = 3.1415926535897932384626433832795;

	${curlNoise}

	vec3 lorenzAttractor(vec3 pos) {
		// Lorenz Attractor parameters
		float a = uA;
		float b = uB;
		float c = uC;

		// Timestep 
		float dt = 0.02;

		float x = pos.x;
		float y = pos.y;
		float z = pos.z;

		float dx, dy, dz;

		dx = dt * (a * (y - x));
		dy = dt * (x * (b - z) - y);
		dz = dt * (x * y - c * z);

		return vec3(dx, dy, dz);
	}

	vec3 lorenzMod2Attractor(vec3 pos) {
		// Lorenz Mod2 Attractor parameters
		float a = uA;
		float b = uB;
		float c = uC;
		float d = uD;

		// Timestep 
		float dt = 0.005;

		float x = pos.x;
		float y = pos.y;
		float z = pos.z;

		float dx, dy, dz;

		dx = (-a*x+ y*y - z*z + a *c) * dt;
		dy = (x*(y-b*z)+d)  * dt;
		dz = (-z + x*(b*y +z))  * dt;

		return vec3(dx, dy, dz);
	}

	vec3 thomasAttractor(vec3 pos) {
		float a = uA;

		// Timestep 
		float dt = 0.1;

		float x = pos.x;
		float y = pos.y;
		float z = pos.z;

		float dx, dy, dz;

		dx = (-a*x + sin(y)) * dt;
		dy = (-a*y + sin(z)) * dt;
		dz = (-a*z + sin(x)) * dt;

		return vec3(dx, dy, dz);
	}

	vec3 dequanAttractor(vec3 pos) {
		float a = uA;
		float b = uB;
		float c = uC;
		float d = uD;
		float e = uE;
		float f = uF;

		// Timestep 
		float dt = 0.0005;

		float x = pos.x;
		float y = pos.y;
		float z = pos.z;

		float dx, dy, dz;

		dx = ( a*(y-x) + c*x*z) * dt;
		dy = (e*x + f*y - x*z) * dt;
		dz = (b*z + x*y - d*x*x) * dt;

		return vec3(dx, dy, dz);
	}

	vec3 dradasAttractor(vec3 pos) {
		float a = uA;
		float b = uB;
		float c = uC;
		float d = uD;
		float e = uE;

		// Timestep 
		float dt = 0.020;

		float x = pos.x;
		float y = pos.y;
		float z = pos.z;

		float dx, dy, dz;

		dx = (y- a*x +b*y*z) * dt;
		dy = (c*y -x*z +z) * dt;
		dz = (d*x*y - e*z) * dt;

		return vec3(dx, dy, dz);
	}

	vec3 arneodoAttractor(vec3 pos) {
		float a = uA;
		float b = uB;
		float c = uC;

		// Timestep 
		float dt = 0.015;

		float x = pos.x;
		float y = pos.y;
		float z = pos.z;

		float dx, dy, dz;

		dx = y * dt;
		dy = z * dt;
		dz = (-a * x - b * y - z + c * pow(x, 3.)) * dt;
		return vec3(dx, dy, dz);

	}

	vec3 aizawaAttractor(vec3 pos) {
		float a = uA;
		float b = uB;
		float c = uC;
		float d = uD;
		float e = uE;
		float f = uF;

		// Timestep 
		float dt = 0.015;

		float x = pos.x;
		float y = pos.y;
		float z = pos.z;

		float dx, dy, dz;

		dx = ((z-b) * x - d*y) * dt;
		dy = (d * x + ((z-b) * y)) * dt;
		dz = (c + a*z - (pow(z, 3.) / 3.0) - (pow(x, 2.) + pow(y, 2.))*(1. - e*z) + (f * z * (pow(x, 3.)))) * dt;

		return vec3(dx, dy, dz);
	}

	vec3 chenLeeAttractor(vec3 pos) {

		float a = uA;
		float b = uB;
		float c = uC;

		// Timestep 
		float dt = 0.03;
	
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
	
		float dx, dy, dz;
	
		dx = ((a * x) - (y * z)) * dt;
		dy = ((b * y) + (x * z)) * dt;
		dz = ((c * z) + ((x * y) / 3.)) * dt;
	
		return vec3(dx, dy, dz);

	}

	vec3 rosslerAttractor(vec3 pos) {

		float a = uA;
		float b = uB;
		float c = uC;
	
		// Timestep 
		float dt = 0.05;
	
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
	
		float dx, dy, dz;
	
		dx = (-y - z) * dt;
		dy = (x + (a * y)) * dt;
		dz = (b + z * (x - c)) * dt;
	
		return vec3(dx, dy, dz);
		
	}

	vec3 sprottBAttractor(vec3 pos) {
		float a = uA;
		float b = uB;
		float c = uC;

		// Timestep 
		float dt = 0.035;
	
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
	
		float dx, dy, dz;

		dx = (a * y * z) * dt;
		dy = (x - b * y) * dt;
		dz = (c - x * y) * dt;

		return vec3(dx, dy, dz);

	}

	vec3 sprottLinzFAttractor(vec3 pos) {
		float a = uA;
		// Timestep 
		float dt = 0.035;
	
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
	
		float dx, dy, dz;

		dx = (y + z) * dt;
		dy = (-x + (a * y)) * dt;
		dz = (pow(x, 2.) - z) * dt;

		return vec3(dx, dy, dz);
	}


	vec3 halvorsenAttractor(vec3 pos) {
		float a = uA;

		// Timestep 
		float dt = 0.01;
	
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
	
		float dx, dy, dz;

		dx = (-a * x - 4. * y - 4. * z - y * y) * dt;
		dy = (-a * y - 4. * z - 4. * x - z * z) * dt;
		dz = (-a * z - 4. * x - 4. * y - x * x) * dt;

		return vec3(dx, dy, dz);
	}

	vec3 unifiedChaoticSystemAttractor(vec3 pos) {
		float a = uA;
		float b = uB;
		float c = uC;
		float d = uD;
		float e = uE;

		// Timestep 
		float dt = 0.02;
	
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
	
		float dx, dy, dz;

		dx = (a*(y-x) + d*x*z)   * dt * 0.1 ;
		dy = (c*y - x*z )        * dt * 0.1 ;
		dz = (b*z + x*y - e*x*x) * dt * 0.1 ;

		return vec3(dx, dy, dz);
	}

	vec3 quadraticStrangeAttractor(vec3 pos) {

		float a0 = -0.875;
		float a1 = -0.173;
		float a2 = 0.307;
		float a3 = -0.436;
		float a4 = 0.598;
		float a5 = 0.003;
		float a6 = -0.039;
		float a7 = 0.96;
		float a8 = -0.84;
		float a9 = 0.885;
		float a10 = 0.774;
		float a11 = 0.281;
		float a12 = -0.015;
		float a13 = 0.585;
		float a14 = 0.442;
		float a15 = -0.18;
		float a16 = -0.535;
		float a17 = -0.151;
		float a18 = -0.971;
		float a19 = -0.48;
		float a20 = 0.777;
		float a21 = 0.418;
		float a22 = 0.185;
		float a23 = 0.006;
		float a24 = 0.45;
		float a25 = -0.066;
		float a26 = 0.498;
		float a27 = 0.142;
		float a28 = -0.246;
		float a29 = -0.939;
		

		// Timestep 
		float dt = 0.01;
	
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
	
		float dx, dy, dz;

		dx = (a0 + a1 * x + a2 * y + a3 * z + a4 * x * y + a5 * x * z + a6 * y * z + a7 * pow(x, 2.) + a8 * pow(y, 2.) + a9 * pow(z, 2.)) * dt;
		dy = (a10 + a11 * x + a12 * y + a13 * z + a14 * x * y + a15 * x * z + a16 * y * z + a17 * pow(x, 2.) + a18 * pow(y, 2.) + a19 * pow(z, 2.)) * dt;
		dz = (a20 + a21 * x + a22 * y + a23 * z + a24 * x * y + a25 * x * z + a26 * y * z + a27 * pow(x, 2.) + a28 * pow(y, 2.) + a29 * pow(z, 2.)) * dt;

		return vec3(dx, dy, dz);

	}

	//doesnt really work
	// vec3 kingsDreamAttractor(vec3 pos) {
	// 	// anything between -3 and +3
	// 	float a = -1.;
	// 	float b = 1.;
	// 	float c = 1.;

	// 	//anything between -.5 and + 1.5
	// 	float d = -1.;
	// 	float e = - 1.;
	// 	float f = 1.;
	// 	// Timestep 
	// 	float dt = 0.03;
	
	// 	float x = pos.x;
	// 	float y = pos.y;
	// 	float z = pos.z;
	
	// 	float dx, dy, dz;

	// 	dx = (cos(y * a) + d * sin(x * a)) * dt;
	// 	dy = (sin(x * b) + e * sin(y * b)) * dt;
	// 	dz = (cos(x * c) + f * sin(z * c)) * dt;

	// 	return vec3(dx, dy, dz);
	// }

	vec3 lorenz83Attractor(vec3 pos) {
		float a = uA;
		float b = uB;
		float c = uC;
		float d = uD;

		
		// Timestep 
		float dt = 0.01;
		
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
		float dx, dy, dz;

		dx = (-a * x - pow(y, 2.) - pow(z, 2.) + a*c) * dt;
		dy = (-y + x*y - b*x*z + d) * dt;
		dz = (-z + b*x*y + x*z) * dt;

		return vec3(dx, dy, dz);

	}

	
	vec3 sprottAttractor(vec3 pos) {
		float a = uA;
		float b = uB;

		// Timestep 
		float dt = 0.04;
		
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
		float dx, dy, dz;

		dx = (y + a*x*y + x*z) * dt;
		dy = (1. - b*pow(x, 2.) + y*z) * dt;
		dz = (x - pow(x, 2.) - pow(y, 2.)) * dt;

		return vec3(dx, dy, dz);
	}

	vec3 fourWingAttractor(vec3 pos) {
		float a = uA;
		float b = uB;
		float c = uC;

		// Timestep 
		float dt = 0.03;
		
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
		float dx, dy, dz;

		dx = (a*x + y*z) * dt;
		dy = (b*x + c*y - x*z) * dt;
		dz = (-z - x*y) * dt;

		return vec3(dx, dy, dz);
	}

	vec3 ruSack(vec3 pos) {
		float a = uA;
		float b = uB;

		// Timestep 
		float dt = 0.03;
		
		float x = pos.x;
		float y = pos.y;
		float z = pos.z;
		float dx, dy, dz;

		// dx=(1.+(sin(PI * a) * sin(PI * b))) * sin((4. * PI) * b);
		// dy=(1.+(sin(PI * a) * sin(PI * b))) * cos((4. * PI) * b);
		// dz=(cos(PI * a) * sin(PI * b))+(4. * b) - 2.;
		dx = sin(x);
		dy = cos(y);
		dz = sin(x);

		return vec3(dx, dy, dz);
	}

	void main() {
		vec3 pos = texture2D(positions, vUv).rgb;
		vec3 delta;
		
		if(attractor == 0.0) {
			delta = lorenzAttractor(pos);
		}

		if(attractor == 1.0) {
			delta = lorenzMod2Attractor(pos);
		}

		if(attractor == 2.0) {
			delta = thomasAttractor(pos);
		}

		if(attractor == 3.0) {
			delta = dequanAttractor(pos);
		}

		if(attractor == 4.0) {
			delta = dradasAttractor(pos);
		}

		if(attractor == 5.0) {
			delta = arneodoAttractor(pos);
		}

		if(attractor == 6.0) {
			delta = aizawaAttractor(pos);
		}

		if (attractor == 7.0) {
			delta = chenLeeAttractor(pos);
		}

		if (attractor == 8.0) {
			delta = rosslerAttractor(pos);
		}
		
		if (attractor == 9.0) {
			delta = sprottBAttractor(pos);
		}

		if (attractor == 10.) {
			delta = sprottLinzFAttractor(pos);
		}

		if (attractor == 11.) {
			delta = halvorsenAttractor(pos);
		}

		if (attractor == 12.) {
			delta = unifiedChaoticSystemAttractor(pos);
		}

		if (attractor == 14.) {
			delta = quadraticStrangeAttractor(pos);
		}

		//   if (attractor == 13.) {
		// 	delta = kingsDreamAttractor(pos);
		//   }

		if (attractor == 15.) {
			delta = lorenz83Attractor(pos);
		}

		if (attractor == 16.) {
			delta = sprottAttractor(pos);
		}

		if (attractor == 17.) {
			delta = fourWingAttractor(pos);
		}

		if (attractor == 18.) {
			delta = ruSack(pos);
		}


		if (attractor == -1.0) {
			delta = vec3(0.);
		}

		pos.x += delta.x;
		pos.y += delta.y;
		pos.z += delta.z;
	
		if (uCurlIntensity > 0.) {
			pos += curlNoise(pos * uCurlIntensity) * uCurlAmplitude;
		}

		gl_FragColor = vec4(pos,1.0);
	}
`;
const simulationVertexShader = `
	varying vec2 vUv;

	void main() {
		vUv = uv;

		vec4 modelPosition = modelMatrix * vec4(position, 1.0);
		vec4 viewPosition = viewMatrix * modelPosition;
		vec4 projectedPosition = projectionMatrix * viewPosition;

		gl_Position = projectedPosition;
	}

`;

// thank you Maxime https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/
const getRandomData = (width, height) => {
	// we need to create a vec4 since we're passing the positions to the fragment shader
	// data textures need to have 4 components, R, G, B, and A
	const length = width * height * 4;
	const data = new Float32Array(length);

	for (let i = 0; i < length; i++) {
		const stride = i * 4;

		const distance = Math.sqrt(Math.random() - 0.5) * 2.0;
		const theta = MathUtils.randFloatSpread(360);
		const phi = MathUtils.randFloatSpread(360);

		data[stride] = distance * Math.sin(theta) * Math.cos(phi);
		data[stride + 1] = distance * Math.sin(theta) * Math.sin(phi);
		data[stride + 2] = distance * Math.cos(theta);
		data[stride + 3] = 1.0; // this value will not have any impact
	}

	return data;
};

const simulationUniforms = {
	positions: { value: null },
	uFrequency: { value: 0.25 },
	uCurlIntensity: { value: 0 },
	uCurlAmplitude: { value: 0 },
	attractor: { value: null },
	uA: { value: 0 },
	uB: { value: 0 },
	uC: { value: 0 },
	uD: { value: 0 },
	uE: { value: 0 },
	uF: { value: 0 },
};
class SimulationMaterial extends ShaderMaterial {
	constructor(size, selectedAttractor) {
		const positionsTexture = new DataTexture(
			getRandomData(size, size),
			size,
			size,
			RGBAFormat,
			FloatType,
		);
		simulationUniforms.positions.value = positionsTexture;
		simulationUniforms.attractor.value = selectedAttractor;

		positionsTexture.needsUpdate = true;

		super({
			uniforms: simulationUniforms,
			vertexShader: simulationVertexShader,
			fragmentShader: simulationFragmentShader,
		});
	}
}
extend({ SimulationMaterial });

const uniforms = {
	uPositions: {
		value: null,
	},
	uInnerColor: {
		value: {
			r: 1,
			g: 1,
			b: 1,
		}
	},
	uOuterColor: {
		value: {
			r: 1,
			g: 1,
			b: 1,
		}
	},
	uSelectedAttractor: {
		value: null
	},
	uParticleSize: {
		value: 4.0
	},
	uSizeAttenuationMultiplier: {
		value: 4.5,
	}
}

const LorenzMod2BaseParams = {
	a: 0.9,
	b: 5.0,
	c: 9.9,
	d: 1.0,
}

const LorenzBaseParams = {
	a: 5.0,
	b: 14.0,
	c: 1.33333,
}

const ThomasBaseParams = {
	a: 0.19,
}

const DequanBaseParams = {
	a: 40.,
	b: 1.833,
	c: 0.16,
	d: 0.65,
	e: 55.,
	f: 20.,
}

const DradasBaseParams = {
	a: 3.,
	b: 2.7,
	c: 1.7,
	d: 2.,
	e: 9.,
};

const ArneodoBaseParams = {
	a: -5.5,
	b: 3.5,
	c: -1.,
}

const AizawaBaseParams = {
	a: 0.95,
	b: 0.7,
	c: 0.6,
	d: 3.5,
	e: .25,
	f: .1,
}

const ChenLeeBaseParams = {
	a: 1.66,
	b: -3.33,
	c: -.126,
}

const RosslerBaseParams = {
	a: 0.2,
	b: 0.2,
	c: 5.7,
}

const SprottBBaseParams = {
	a: 0.4,
	b: 1.2,
	c: 1.,
}

const SprottLinzFBaseParams = {
	a: 0.5,
}

const HalvorsenBaseParams = {
	a: 1.4,
}

const UnifiedChaoticSystemParams = {
	a: 40.0,
	b: 0.833,
	c: 20.0,
	d: 0.5,
	e: 0.65,
}

const Lorenz83Params = {
	a: 0.95,
	b: 7.91,
	c: 4.83,
	d: 4.66
}

const SprottParams = {
	a: 2.07,
	b: 1.79
}

const FourWingParams = {
	a: 0.2,
	b: 0.01,
	c: -0.4
}

const idk = {
	a: 0.5,
	b: 0.5
}


const mapParamToLevaParam = (param) => {
	return Object.entries(param).reduce((acc, [key, value]) => {
		acc[key] = {
			value: value,
			min: Math.min(-value, value * 2),
			max: Math.max(-value, value * 2),
			step: 0.01,
			onChange: (v) => {
				simulationUniforms[`u${key.toUpperCase()}`].value = v;
			}
		}
		return acc;
	}, {});
}

const getBaseParamsPerAttractor = (attractorId, mapToLeva = true) => {
	switch (attractorId) {
		case 0:
			return mapToLeva ? mapParamToLevaParam(LorenzBaseParams) : LorenzBaseParams
		case 1:
			return mapToLeva ? mapParamToLevaParam(LorenzMod2BaseParams) : LorenzMod2BaseParams
		case 2:
			return mapToLeva ? mapParamToLevaParam(ThomasBaseParams) : ThomasBaseParams
		case 3:
			return mapToLeva ? mapParamToLevaParam(DequanBaseParams) : DequanBaseParams
		case 4:
			return mapToLeva ? mapParamToLevaParam(DradasBaseParams) : DradasBaseParams
		case 5:
			return mapToLeva ? mapParamToLevaParam(ArneodoBaseParams) : ArneodoBaseParams
		case 6:
			return mapToLeva ? mapParamToLevaParam(AizawaBaseParams) : AizawaBaseParams
		case 7:
			return mapToLeva ? mapParamToLevaParam(ChenLeeBaseParams) : ChenLeeBaseParams
		case 8:
			return mapToLeva ? mapParamToLevaParam(RosslerBaseParams) : RosslerBaseParams
		case 9:
			return mapToLeva ? mapParamToLevaParam(SprottBBaseParams) : SprottBBaseParams
		case 10:
			return mapToLeva ? mapParamToLevaParam(SprottLinzFBaseParams) : SprottLinzFBaseParams
		case 11:
			return mapToLeva ? mapParamToLevaParam(HalvorsenBaseParams) : HalvorsenBaseParams
		case 12:
			return mapToLeva ? mapParamToLevaParam(UnifiedChaoticSystemParams) : UnifiedChaoticSystemParams
		case 15:
			return mapToLeva ? mapParamToLevaParam(Lorenz83Params) : Lorenz83Params
		case 16:
			return mapToLeva ? mapParamToLevaParam(SprottParams) : SprottParams
		case 17:
			return mapToLeva ? mapParamToLevaParam(FourWingParams) : FourWingParams
		case 18:
			return mapToLeva ? mapParamToLevaParam(idk) : idk
		default:
			return {};
	}
}

//keep these outside the react rendering cycle, we dont need to re-render the component when these change
let tempBufferSwap;
let pause;
// ugh stale closure, cant be bothered to debug
let restartTemp = false;
const Particles = () => {
	const [, restart] = useState(false);

	const { scene: currentScene, gl } = useThree();
	const colors = getRandomColors();
	const [innerColor, outerColor] = colors;
	const [{ attractor: selectedAttractor, count: particlesCount }, set] = useControls(() => ({

		attractor: {
			options: {
				'Lorenz Mod2 Attractor': 1,
				'Thomas Attractor': 2,
				'Dradas Attractor': 4,
				'Aizawa Attractor': 6,
				'Chen-Lee Attractor': 7,
				'Lorenz 83 Attractor': 15,
				'Rossler Attractor': 8,
				'Sprott B Attractor': 9,
				'Sprott-Linz F Attractor': 10,
				'Sprott Attractor': 16,
				'Four-Wing Attractor': 17,
				'Halvorsen Attractor': 11,
				'Three-Scroll Unified Chaotic System Attractor 1': 12,
				'Dequan Attractor': 3,
				'Lorenz Attractor': 0,
				'Arneodo Attractor (might not work corrently on all GPUs)': 5,
				'Just curl noise': -1,
				'quadraticStrangeAttractor (WIP)': 14,
				'idk': 18,
			}
		},
		innerColor: {
			value: innerColor,
			onChange: (v) => {
				uniforms.uInnerColor.value = new Color(v)
			},
		},
		outerColor: {
			value: outerColor,
			onChange: (v) => {
				uniforms.uOuterColor.value = new Color(v)
			}
		},
		curlIntensity: {
			value: 0,
			min: 0,
			max: 0.3,
			step: 0.01,
			onChange: (v) => {simulationUniforms.uCurlIntensity.value = v},
		},
		curlAmplitude: {
			value: 0,
			min: 0,
			max: 0.3,
			step: 0.01,
			onChange: (v) => {simulationUniforms.uCurlAmplitude.value = v},
		},

		backgroundColor: {
			value: new Color(0.01, 0.01, 0.01).multiplyScalar(255),
			onChange: (v) => {
				currentScene.background = new Color(v.r, v.g, v.b).multiplyScalar(1 / 255)
			}
		},
		pause: {
			value: false,
			onChange: (v) => { pause = v }
		},
		restart: button(() => {
			// idk how to make leva not have a stale closure here, so i'll just work around it for now
			//TODO: fix me
			restartTemp = !restartTemp;
			restart(restartTemp)
		}),
		'Particles Controls': folder({
			count: {
				value: 128 * 11,
				min: 128,
				max: 128 * 25,
				step: 128,
			},
			size: {
				value: 4,
				min: 1,
				max: 10,
				step: 1,
				onChange: (v) => {uniforms.uParticleSize.value = v},
			},
			sizeAttenuationMultiplier: {
				value: 6.5,
				min: 1,
				max: 12,
				step: 0.5,
				onChange: (v) => {uniforms.uSizeAttenuationMultiplier.value = v},
			}
		}, {
			collapsed: true
		})
	}));

	const [, setAttractorParams] = useControls(
		'Attractor Params',
		() => {
			return {
				reset: button(
					() => setAttractorParams(getBaseParamsPerAttractor(selectedAttractor, false))
				),
				...getBaseParamsPerAttractor(selectedAttractor),
			}
		},
		{
			collapsed: true
		},
		[selectedAttractor]
	)

	uniforms.uSelectedAttractor.value = selectedAttractor;

	const points = useRef();
	const simulationMaterialRef = useRef();

	const scene = new TScene();
	const camera = useMemo(() => new OrthographicCamera(-1, 1, 1, -1, 1 / Math.pow(2, 53), 1), []);
	const positions = useMemo(() => new Float32Array([
		-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
	]), [])
	const uvs = useMemo(() => new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]), []);

	let renderTarget1 = useFBO(particlesCount, particlesCount, {
		minFilter: NearestFilter,
		magFilter: NearestFilter,
		format: RGBAFormat,
		stencilBuffer: false,
		type: FloatType,
	});

	let renderTarget2 = renderTarget1.clone();

	const particlesPosition = useMemo(() => {
		const length = particlesCount * particlesCount;
		const particles = new Float32Array(length * 3);

		for (let i = 0; i < length; i++) {
			const i3 = i * 3;
			particles[i3 + 0] = (i % particlesCount) / particlesCount;
			particles[i3 + 1] = i / particlesCount / particlesCount;
		}

		return particles;

	}, [particlesCount]);

	useLayoutEffect(() => {
		// avoid feedback loop for the textures render pingpong on re-renders
		if (renderTarget1.texture) {
			renderTarget1.texture.dispose();
			renderTarget1.dispose();
		}
		if (renderTarget2.texture) {
			renderTarget2.texture.dispose();
			renderTarget2.dispose();
		}
		if (tempBufferSwap?.texture) {
			tempBufferSwap.texture.dispose();
			tempBufferSwap.dispose();
		}
		gl.setRenderTarget(renderTarget1);
		gl.clear();
		gl.render(scene, camera);
		gl.setRenderTarget(renderTarget2);
		gl.clear();
		gl.render(scene, camera);
		gl.setRenderTarget(null);
	});

	useEffect(() => {
		setAttractorParams(getBaseParamsPerAttractor(selectedAttractor, false))
		//TODO: should colors change on each re-render?
		set({ innerColor, outerColor });
	}, [selectedAttractor]);


	useFrame((state) => {
		if (pause) return;
		const { gl } = state;

		tempBufferSwap = renderTarget1;
		renderTarget1 = renderTarget2;
		renderTarget2 = tempBufferSwap;

		simulationMaterialRef.current.uniforms.positions.value = renderTarget1.texture;

		gl.setRenderTarget(renderTarget2);
		gl.clear();
		gl.render(scene, camera);
		gl.setRenderTarget(null);
		uniforms.uPositions.value = renderTarget1.texture;
	});

	return (
		<>
			{createPortal(
				<mesh >
					<simulationMaterial key={`attractor${selectedAttractor}${particlesPosition.length}`} ref={simulationMaterialRef} args={[particlesCount, selectedAttractor]} />
					<bufferGeometry>
						<bufferAttribute
							attach="attributes-position"
							count={positions.length / 3}
							array={positions}
							itemSize={3}
						/>
						<bufferAttribute
							attach="attributes-uv"
							count={uvs.length / 2}
							array={uvs}
							itemSize={2}
						/>
					</bufferGeometry>
				</mesh>,
				scene,
			)}
			<points key={`points${selectedAttractor}${particlesPosition.length}`} frustumCulled={false} ref={points}>
				<bufferGeometry>
					<bufferAttribute
						attach="attributes-position"
						count={particlesPosition.length / 3}
						array={particlesPosition}
						itemSize={3}
					/>
				</bufferGeometry>
				<shaderMaterial
					blending={AdditiveBlending}
					depthWrite={false}
					fragmentShader={fragmentShader}
					vertexShader={vertexShader}
					uniforms={uniforms}
				/>
			</points>
		</>
	);
};

const Scene = () => {
	return (
		<>
			<Particles />
		</>
	);
};

//TODO: fix resize re-render
export default function App() {
	return (
		<>
			<Canvas
				camera={{
					near: 0.1,
					far: 90000,
					fov: 45,
					position: [15, 18, 18],
				}}
				dpr={Math.max(window.devicePixelRatio, 2)}
			>
				{/* <Stats /> */}
				<OrbitControls />
				<ambientLight intensity={1} />
				<PostEffects />
				<Suspense fallback={null}>
					<Scene />
				</Suspense>
			</Canvas>
		</>
	);
}

//ehhhh
const PostEffects = () => {
	return (
		<EffectComposer>
			<Bloom 
				mipmapBlur
                intensity={1.95}
                radius={0.5}
                luminanceThreshold={0.2}
                luminanceSmoothing={0.5}
			/>
		</EffectComposer>
	);
};
