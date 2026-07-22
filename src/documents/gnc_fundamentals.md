# GNC Fundamentals for Robotics Interviews

## State Estimation

### Kalman Filter Family

#### Extended Kalman Filter (EKF)
- Linearizes nonlinear systems around current estimate
- Prediction: x_pred = f(x, u), P_pred = F*P*F' + Q
- Update: K = P_pred*H' / (H*P_pred*H' + R), x = x_pred + K*(z - h(x_pred))
- Pros: Computationally efficient, well-understood
- Cons: Can diverge with high nonlinearity, requires Jacobians

#### Unscented Kalman Filter (UKF)
- Uses sigma points instead of linearization
- Better handles nonlinearity than EKF
- No Jacobian computation required
- Higher computational cost (2n+1 sigma points)

#### Error-State Kalman Filter (ESKF)
- Estimates error in nominal state, not full state
- Common for IMU-based systems
- Avoids singularities in orientation representation
- Used in most production robotics systems

### Sensor Fusion Architecture

Typical IMU + GPS + Wheel Odometry fusion:
```
IMU (100-1000Hz) -> Prediction step (high rate)
GPS (1-10Hz) -> Update step (low rate, global)
Wheel Odom (50Hz) -> Update step (local, continuous)
```

Key considerations:
- Time synchronization (use timestamps, not arrival time)
- Sensor delays (IMU ~0ms, GPS ~50-200ms, camera ~30-100ms)
- Outlier rejection (Mahalanobis distance, RANSAC)

### Covariance Tuning
- Process noise Q: How much you trust your model
- Measurement noise R: How much you trust sensors
- Start with sensor datasheets, tune empirically
- Watch for filter divergence (covariance explosion)

## Localization

### SLAM Algorithms

#### Cartographer (Google)
- Graph-based SLAM with loop closure
- Works with 2D lidar, 3D lidar, or combined
- Local SLAM: scan matching, motion filter
- Global SLAM: loop closure detection, pose graph optimization

#### SLAM Toolbox (ROS2 default)
- Based on Karto SLAM
- Lifelong mapping capability
- Serialization/deserialization of maps
- Good for indoor structured environments

#### RTAB-Map
- RGB-D and stereo camera SLAM
- Memory management for large-scale mapping
- Loop closure with visual features
- Can fuse lidar, camera, odometry

### Particle Filter (Monte Carlo Localization)
- Represents belief as weighted particles
- Used for global localization in known map
- AMCL (Adaptive Monte Carlo Localization) in Nav2
- Handles multimodal distributions (kidnapped robot)

### Map Representations
- Occupancy Grid: 2D probability grid (0-100, -1 unknown)
- Costmap: Layered (static, obstacle, inflation)
- Point Cloud Map: 3D representation
- Feature Map: Landmarks with uncertainty

## Path Planning

### Global Planners

#### A* / Dijkstra
- Graph search on discretized space
- A* uses heuristic (usually Euclidean distance)
- Optimal for grid-based planning
- NavFn in Nav2 uses A*

#### Lattice Planners
- Pre-computed motion primitives
- Respects kinematic constraints
- Smac Planner in Nav2
- Good for car-like robots (Ackermann)

#### RRT / RRT*
- Rapidly-exploring Random Trees
- Good for high-dimensional spaces
- RRT* provides asymptotic optimality
- Used for manipulation, complex environments

### Local Planners / Controllers

#### DWA (Dynamic Window Approach)
- Samples velocity space (v, omega)
- Simulates trajectories forward
- Scores based on: goal heading, clearance, velocity
- Fast, works well for differential drive

#### TEB (Timed Elastic Band)
- Optimizes trajectory as elastic band
- Considers dynamic obstacles
- Respects kinematic constraints
- Good for car-like robots

#### MPC (Model Predictive Control)
- Solves optimization over prediction horizon
- Can handle constraints explicitly
- Receding horizon: re-solve at each timestep
- MPPI (Model Predictive Path Integral) - sampling-based MPC

#### Pure Pursuit
- Geometric path tracking
- Follows carrot point on path at lookahead distance
- Simple, robust, good for high-speed
- Lookahead tuning: too short = oscillation, too long = corner cutting

#### Regulated Pure Pursuit (Nav2 default)
- Adapts lookahead based on curvature
- Slows down for curves
- Better than basic pure pursuit for varied paths

## Control Theory

### PID Control
- P: Proportional to error (main drive)
- I: Integral of error (eliminates steady-state error)
- D: Derivative of error (damping, reduces overshoot)

Tuning methods:
- Ziegler-Nichols: Find ultimate gain and period
- Manual: Start with P only, add D for stability, add I last
- Watch for: windup (saturate I term), derivative kick

### Feedforward Control
- Model-based prediction of required input
- Combined with feedback (PID) for robustness
- Example: gravity compensation in arm control

### Trajectory Tracking
- Reference trajectory: x_ref(t), v_ref(t), a_ref(t)
- Error dynamics: e = x - x_ref
- Feedforward + feedback: u = u_ff + K*e

## Behavior Planning

### Behavior Trees
- Hierarchical task decomposition
- Nodes: Sequence, Fallback, Parallel, Action, Condition
- Tick-based execution model
- BehaviorTree.CPP in Nav2

Example structure:
```
Root
  Fallback
    Sequence [Navigate]
      ComputePath
      FollowPath
    Sequence [Recovery]
      ClearCostmap
      Spin
      Wait
```

### State Machines
- Explicit state transitions
- Good for mode switching
- SMACH, SMACC2 in ROS2
- Easier to visualize than behavior trees

## Sensor Specifics

### LiDAR
- 2D (planar) vs 3D (multi-beam, spinning)
- Key specs: range, angular resolution, scan rate
- Preprocessing: outlier removal, ground segmentation
- Popular: Velodyne, Ouster, Livox (solid-state)

### IMU
- 6-DOF: 3-axis accel + 3-axis gyro
- 9-DOF: adds 3-axis magnetometer
- Key specs: noise density, bias stability, bandwidth
- Integration drift: gyro integrates to angle, accel double-integrates to position
- Bias estimation critical for long-term accuracy

### Camera
- Monocular: scale ambiguity
- Stereo: depth from disparity
- RGB-D: direct depth (structured light or ToF)
- Key specs: resolution, FPS, FOV, global vs rolling shutter

### GPS/GNSS
- Standard GPS: ~2-5m accuracy
- RTK GPS: ~2cm accuracy (requires base station)
- GPS-denied: Need alternative localization
- Multipath issues in urban canyons

## Common Debugging Approaches

### Localization Issues
1. Check tf tree: `ros2 run tf2_tools view_frames`
2. Visualize in RViz: map, odom, base_link alignment
3. Check sensor data quality (lidar returns, IMU biases)
4. Verify covariances are reasonable

### Navigation Failures
1. Check costmap: obstacles appearing correctly?
2. Verify global/local planner parameters
3. Check recovery behaviors triggering
4. Look for oscillation (parameter tuning)

### Performance Issues
1. Profile with `ros2 topic hz` and `ros2 topic bw`
2. Check CPU/memory usage per node
3. Consider composable nodes for zero-copy
4. Reduce sensor rates if not needed
