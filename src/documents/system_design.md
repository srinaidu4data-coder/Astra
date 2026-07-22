# Autonomy System Design Reference

## Generic Autonomy Stack Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MISSION LAYER                           │
│  Task Planning, Mission Control, Fleet Management               │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       BEHAVIOR LAYER                            │
│  Behavior Trees, State Machines, Decision Making                │
└─────────────────────────────────────────────────────────────────┘
                              │
┌───────────────┬─────────────┴─────────────┬───────────────────┐
│  PERCEPTION   │        PLANNING           │     CONTROL       │
│  Detection    │  Global Path Planning     │  Trajectory       │
│  Tracking     │  Local Planning           │  Following        │
│  Prediction   │  Motion Planning          │  Low-level        │
└───────────────┴───────────────────────────┴───────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                     LOCALIZATION LAYER                          │
│  State Estimation, SLAM, Map Management                         │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       SENSOR LAYER                              │
│  Drivers, Preprocessing, Calibration, Time Sync                 │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      HARDWARE LAYER                             │
│  Sensors, Actuators, Compute, Power                             │
└─────────────────────────────────────────────────────────────────┘
```

## Design Pattern: Sense-Plan-Act

Traditional robotics loop:
1. **Sense**: Read sensors, update world model
2. **Plan**: Compute action based on current state and goal
3. **Act**: Execute commands to actuators

Modern variation with parallel pipelines:
- Perception runs continuously, updating world model
- Planning runs at medium rate, recomputing paths
- Control runs at high rate, tracking trajectory
- State estimation runs at highest rate, fusing sensors

## Data Flow Rates (Typical)

| Component | Rate | Rationale |
|-----------|------|-----------|
| IMU | 100-1000 Hz | High bandwidth inertial data |
| LiDAR | 10-20 Hz | Full scan rate |
| Camera | 30-60 Hz | Frame rate |
| State Estimation | 100-1000 Hz | Matches IMU |
| Perception | 10-30 Hz | Processing limited |
| Global Planning | 1-2 Hz | Expensive, stable |
| Local Planning | 10-20 Hz | React to changes |
| Control | 50-100 Hz | Smooth actuation |
| Motor Commands | 100-1000 Hz | PWM/current loop |

## Mobile Robot Architectures

### Differential Drive Robot (Indoor AMR)

**Sensors**:
- 2D LiDAR: navigation, obstacle detection
- RGB-D camera: object detection, 3D obstacles
- Wheel encoders: odometry
- IMU: orientation, slip detection
- Bumpers/cliff sensors: safety

**Localization**:
- AMCL on pre-built map (typical for structured environments)
- Or SLAM for dynamic environments

**Navigation Stack** (Nav2):
```
map_server -> amcl -> bt_navigator
                         │
              ┌──────────┴──────────┐
              │                     │
         planner_server      controller_server
         (global path)       (local trajectory)
              │                     │
         SmacPlanner2D      RegulatedPurePursuit
```

**Safety Layers**:
1. Costmap inflation (keep-out zones)
2. Velocity limiting near obstacles
3. Emergency stop on bumper contact
4. Watchdog timers

### Ackermann Vehicle (Outdoor)

**Additional Considerations**:
- Non-holonomic constraints (can't move sideways)
- Minimum turning radius
- Higher speeds, longer stopping distance
- GPS for outdoor localization

**Planning**:
- Lattice planner or Hybrid A* (respects kinematics)
- Longer lookahead for stability at speed

**Control**:
- Stanley or Pure Pursuit for path tracking
- Separate longitudinal (speed) and lateral (steering) control

### Aerial Vehicle (Drone)

**Sensors**:
- IMU: critical for attitude estimation
- Barometer: altitude
- GPS: position
- Downward camera/rangefinder: low altitude
- Forward camera/LiDAR: obstacle avoidance

**State Estimation**:
- EKF or ESKF fusing IMU, GPS, baro
- High-rate attitude estimation (critical for stability)

**Control Stack**:
```
Position Controller (outer loop, ~50Hz)
        │
Velocity Controller (middle loop, ~100Hz)
        │
Attitude Controller (inner loop, ~250Hz)
        │
Motor Mixer -> ESCs
```

**Flight Modes**:
- Manual: direct stick-to-motor
- Stabilize: attitude hold
- Altitude Hold: maintain height
- Position Hold: maintain 3D position
- Auto: waypoint following

## Key Design Decisions

### Centralized vs Distributed

**Centralized**:
- Single compute platform
- Easier to debug, consistent timing
- Single point of failure
- Good for: small robots, prototypes

**Distributed**:
- Sensors have local processing
- Multiple compute nodes
- Requires time synchronization
- Network latency considerations
- Good for: large robots, AV, modularity

### Tight vs Loose Sensor Fusion

**Tight Coupling**:
- Raw sensor data into single estimator
- Optimal use of information
- Complex, sensor-specific
- Example: raw IMU + GPS pseudoranges

**Loose Coupling**:
- Each sensor produces pose estimate
- Estimates fused at higher level
- Modular, easier to swap sensors
- Sub-optimal but robust
- Example: IMU odometry + GPS position

### Map Representation

**Occupancy Grid**:
- 2D cells with occupancy probability
- Good for 2D navigation
- Memory: O(area / resolution^2)
- Nav2 costmaps use this

**Voxel Grid**:
- 3D occupancy
- OctoMap: hierarchical, memory efficient
- Good for 3D planning, drones

**Point Cloud Map**:
- Raw 3D points
- Dense, memory intensive
- Good for lidar localization

**Feature Map**:
- Sparse landmarks with uncertainty
- Compact, good for visual SLAM
- ORB-SLAM, VINS uses this

## Failure Handling

### Graceful Degradation
1. Primary localization fails -> fall back to odometry-only
2. Planner fails -> stop and request help
3. Single sensor fails -> continue with others (if fused)

### Safety Monitors
- Watchdog: no commands for N seconds -> stop
- Geofence: outside boundary -> stop
- Velocity limit: near obstacles -> slow down
- Health monitor: sensor timeouts, node crashes

### Recovery Behaviors (Nav2)
1. Clear costmap (remove stale obstacles)
2. Spin in place (clear local area)
3. Back up (escape from tight spot)
4. Wait (let dynamic obstacles pass)

## Performance Metrics

### Localization
- Position error (RMSE vs ground truth)
- Orientation error
- Loop closure success rate
- Relocalization time

### Navigation
- Success rate (reached goal without intervention)
- Path efficiency (actual / optimal)
- Time to goal
- Obstacle clearance

### Control
- Tracking error (cross-track, heading)
- Settling time
- Overshoot
- Smoothness (jerk)

### System
- CPU/memory usage per node
- Message latency (publish to subscribe)
- Sensor-to-action latency
- Uptime, MTBF

## Common Interview Design Questions

### "Design a delivery robot for a warehouse"
Key points:
- Known map, fiducial markers for precise docking
- Fleet coordination (traffic management)
- Robust to humans walking around
- High uptime requirements

### "Design an autonomous car perception system"
Key points:
- Redundancy (lidar + camera + radar)
- Object detection, tracking, prediction
- HD map for localization
- Handling weather, lighting conditions

### "Design a drone for building inspection"
Key points:
- GPS-denied navigation (visual-inertial)
- High-resolution camera for defects
- Flight planning for coverage
- Battery management, safe landing

### "How would you improve localization in a featureless environment"
Key points:
- Add artificial features (reflectors, AprilTags)
- Use different sensor modality (radar)
- Improve odometry (better IMU, wheel calibration)
- Accept higher uncertainty, rely more on odometry
