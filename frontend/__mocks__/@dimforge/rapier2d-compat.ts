/**
 * Manual Jest mock for @dimforge/rapier2d-compat.
 * Implements just enough of the Rapier API for engine.test.ts.
 */

export class MockRigidBody {
  handle: number;
  _x: number;
  _y: number;
  _angle = 0;
  _vx = 0;
  _vy = 0;
  _wakeUpCount = 0;
  _impulses: Array<{ x: number; y: number }> = [];
  _colliders: MockCollider[] = [];

  constructor(handle: number, x: number, y: number) {
    this.handle = handle;
    this._x = x;
    this._y = y;
  }

  translation() {
    return { x: this._x, y: this._y };
  }
  rotation() {
    return this._angle;
  }
  linvel() {
    return { x: this._vx, y: this._vy };
  }
  setLinvel(vel: { x: number; y: number }) {
    this._vx = vel.x;
    this._vy = vel.y;
  }
  wakeUp() {
    this._wakeUpCount++;
  }
  applyImpulse(impulse: { x: number; y: number }, wakeUp: boolean) {
    this._impulses.push({ ...impulse });
    if (wakeUp) this._wakeUpCount++;
  }
  numColliders() {
    return this._colliders.length;
  }
  collider(i: number) {
    return this._colliders[i];
  }
  _addCollider(c: MockCollider) {
    this._colliders.push(c);
  }
}

export class MockCollider {
  handle: number;
  _collisionGroups = 0xffffffff;
  constructor(handle: number) {
    this.handle = handle;
  }
  setCollisionGroups(groups: number) {
    this._collisionGroups = groups;
  }
}

export class MockEventQueue {
  _events: Array<[number, number, boolean]> = [];
  free() {}
  _push(h1: number, h2: number, started: boolean) {
    this._events.push([h1, h2, started]);
  }
  drainCollisionEvents(cb: (h1: number, h2: number, started: boolean) => void) {
    const evts = this._events.splice(0);
    for (const [h1, h2, s] of evts) cb(h1, h2, s);
  }
}

export class MockWorld {
  _bodies = new Map<number, MockRigidBody>();
  _bodyHandleCounter = 0;
  _colliderHandleCounter = 1000;
  _activeEventQueue: MockEventQueue | null = null;
  integrationParameters = { numSolverIterations: 4, dt: 1 / 60 };

  createRigidBody(desc: { x: number; y: number }) {
    const handle = this._bodyHandleCounter++;
    const rb = new MockRigidBody(handle, desc.x, desc.y);
    this._bodies.set(handle, rb);
    return rb;
  }

  createCollider(desc: unknown, rb?: MockRigidBody) {
    const handle = this._colliderHandleCounter++;
    const c = new MockCollider(handle);
    if (rb) rb._addCollider(c);
    // Propagate collision groups from the builder desc if available
    if (desc && typeof (desc as { _getGroups?: () => number })._getGroups === "function") {
      c._collisionGroups = (desc as { _getGroups: () => number })._getGroups();
    }
    return c;
  }

  getRigidBody(handle: number) {
    return this._bodies.get(handle) ?? null;
  }

  removeRigidBody(rb: MockRigidBody) {
    this._bodies.delete(rb.handle);
  }

  step(eq: MockEventQueue) {
    this._activeEventQueue = eq;
  }

  free() {}

  /** Test helper: trigger a collision event between two collider handles. */
  _fireCollision(h1: number, h2: number) {
    this._activeEventQueue?._push(h1, h2, true);
  }

  /**
   * Test helper: force the next createRigidBody call to reuse a specific
   * handle index.  Used to simulate Rapier's generational-arena handle
   * recycling so the tier-snapshot guard in processMerges can be exercised.
   */
  _forceNextHandle(n: number) {
    this._bodyHandleCounter = n;
  }
}

const mockColliderDescBuilder = (initialGroups = 0xffffffff) => {
  let _groups = initialGroups;
  const builder = {
    _getGroups: () => _groups,
    setRestitution: () => builder,
    setFriction: () => builder,
    setDensity: () => builder,
    setActiveEvents: () => builder,
    setTranslation: () => builder,
    setCollisionGroups: (groups: number) => {
      _groups = groups;
      return builder;
    },
  };
  return builder;
};

const RAPIER_MOCK = {
  init: jest.fn().mockResolvedValue(undefined),
  World: jest.fn().mockImplementation(() => new MockWorld()),
  EventQueue: jest.fn().mockImplementation(() => new MockEventQueue()),
  RigidBodyDesc: {
    dynamic: () => {
      let _x = 0,
        _y = 0;
      const builder = {
        get x() {
          return _x;
        },
        get y() {
          return _y;
        },
        setTranslation(x: number, y: number) {
          _x = x;
          _y = y;
          return builder;
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        setCcdEnabled(_enabled: boolean) {
          return builder;
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        setCanSleep(_enabled: boolean) {
          return builder;
        },
      };
      return builder;
    },
  },
  ColliderDesc: {
    ball: jest.fn().mockImplementation(() => mockColliderDescBuilder()),
    cuboid: jest.fn().mockImplementation(() => mockColliderDescBuilder()),
    convexHull: jest.fn().mockImplementation((pts: Float32Array) => {
      if (!pts || pts.length < 6) return null;
      return mockColliderDescBuilder();
    }),
  },
  ActiveEvents: { COLLISION_EVENTS: 1 },
};

export default RAPIER_MOCK;
module.exports = { __esModule: true, default: RAPIER_MOCK, ...RAPIER_MOCK };
