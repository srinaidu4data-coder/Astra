# Common Robotics Interview Questions and Approaches

## ROS2 Questions

### Q: Explain the difference between topics, services, and actions in ROS2
Topics are publish-subscribe for continuous data streams like sensor readings - async and many-to-many. Services are synchronous request-response for quick discrete operations like parameter changes. Actions are for long-running tasks with feedback - they support preemption and progress updates, perfect for navigation or manipulation goals.

### Q: How does tf2 work and why is it important?
tf2 maintains a tree of coordinate transforms between frames. Every sensor, link, and reference frame has a relationship. The buffer stores recent transforms (usually 10s) so you can query "where was the lidar frame relative to map 50ms ago?" Critical for sensor fusion - you need to transform all data to a common frame. Common mistake is doing manual transform math instead of using the buffer.

### Q: What's the difference between map and odom frames?
Odom frame is continuous but drifts over time - it's where wheel odometry or visual odometry lives. Map frame is globally consistent but can have discrete jumps when SLAM does loop closure. Robot typically has map->odom->base_link chain. The map->odom transform represents the localization correction.

### Q: How do you debug QoS mismatches?
Run `ros2 topic info -v /topic_name` to see publisher and subscriber QoS settings. Common issue: reliable publisher can talk to best-effort subscriber, but best-effort publisher cannot connect to reliable subscriber. For sensor data, best-effort is usually right. For commands or important messages, reliable.

### Q: Explain node lifecycle in ROS2
Managed nodes have states: unconfigured, inactive, active, finalized. on_configure loads params and allocates resources. on_activate starts processing. on_deactivate pauses without losing state. This gives deterministic startup - you can bring up all nodes to inactive, then activate in order. Essential for safety-critical systems.

## State Estimation Questions

### Q: Explain how an Extended Kalman Filter works
EKF has two steps. Predict: propagate state forward using motion model, grow uncertainty. Update: when measurement arrives, compute Kalman gain based on how much you trust the measurement vs prediction, then correct state and shrink uncertainty. The "extended" part means we linearize nonlinear models using Jacobians at the current estimate.

### Q: When would you use UKF over EKF?
UKF handles nonlinearity better because it uses sigma points instead of linearization. If your system has high nonlinearity - like quaternion orientation or range-bearing measurements - UKF often performs better. Tradeoff is computational cost (2n+1 sigma points). For most robotics, EKF is fine, but UKF shines in highly nonlinear state spaces.

### Q: How do you fuse IMU with GPS?
IMU runs the prediction step at high rate (100-1000Hz) because it gives acceleration and angular velocity. GPS gives position updates at low rate (1-10Hz). Key challenges: GPS has latency (50-200ms typically), so you need to handle delayed measurements. Also outlier rejection - GPS can jump in urban environments.

### Q: How do you tune Kalman filter covariances?
Start with sensor datasheets for measurement noise R. Process noise Q represents model uncertainty - how much the real system deviates from your model. Too small Q: filter is overconfident, slow to correct. Too large Q: filter is jittery. I usually start conservative (larger Q) and tighten based on testing. Watch the innovation sequence - should be zero-mean and match predicted covariance.

### Q: What causes filter divergence?
Usually incorrect covariance tuning - Q too small so filter ignores measurements. Or unmodeled dynamics - your motion model doesn't capture what the robot actually does. Also numerical issues with covariance matrix losing positive definiteness. Fix: use Joseph form update, add small epsilon to diagonal.

## Path Planning Questions

### Q: Explain A* algorithm
A* is graph search that finds optimal path. Maintains open set (frontier) and closed set (visited). Always expands node with lowest f = g + h, where g is cost-so-far and h is heuristic estimate to goal. Heuristic must be admissible (never overestimate) for optimality. For grids, Euclidean distance is common heuristic.

### Q: When would you use RRT over A*?
A* works on discretized space - fine for 2D navigation. RRT excels in high-dimensional continuous spaces like arm planning (6+ DOF). RRT randomly samples and grows tree toward samples. RRT* variant gives asymptotic optimality. Also good when you don't have a grid representation of the space.

### Q: Explain MPC for path following
Model Predictive Control solves an optimization at each timestep: minimize tracking error and control effort over a prediction horizon, subject to constraints. Then apply only the first control, re-solve next timestep (receding horizon). Powerful because you can explicitly handle velocity limits, obstacle constraints. Computationally expensive but feasible on modern hardware.

### Q: What's the difference between global and local planning?
Global planner computes path from start to goal on the map - runs infrequently, considers static obstacles. Local planner tracks that path while avoiding dynamic obstacles - runs at high rate (10-20Hz typically). In Nav2: NavFn or Smac for global, DWA or RPP for local. Local planner handles what global planner can't see.

### Q: How does behavior tree differ from state machine?
State machines have explicit transitions between states - good for clear mode switching but can get complex with many states. Behavior trees are hierarchical: sequence nodes run children in order until one fails, fallback nodes try alternatives. BTs are more modular and composable. Nav2 uses BT for recovery behaviors - try navigate, if fail try clear costmap, if fail try spin.

## Control Questions

### Q: How do you tune a PID controller?
I start with P only - increase until system responds but oscillates. Then add D to damp oscillations. Finally add I to eliminate steady-state error, but keep it small to avoid windup. Ziegler-Nichols gives starting point but usually needs refinement. Key is understanding the physical system - what causes delays, what limits acceleration.

### Q: What's integral windup and how do you prevent it?
When actuator saturates but error persists, integral term keeps growing. When error reverses, huge integral causes overshoot. Fixes: clamp integral term, use conditional integration (only integrate when near setpoint), or back-calculate (reduce integral when output saturates).

### Q: Explain feedforward control
Feedforward uses a model to predict required control input - like computing motor torque needed for desired acceleration. It's proactive rather than reactive. Combined with feedback (PID) that handles model errors and disturbances. Example: gravity compensation in robot arm - feedforward handles known gravity load, PID handles everything else.

## Localization Questions

### Q: How does AMCL work?
Adaptive Monte Carlo Localization uses particle filter. Particles represent possible robot poses. Motion update: move particles according to odometry with noise. Sensor update: weight particles by how well their expected sensor reading matches actual reading. Resample: duplicate high-weight particles, remove low-weight. Adaptive part: vary particle count based on uncertainty.

### Q: How do you handle the kidnapped robot problem?
AMCL can inject random particles to cover the map when all particles have low weight. But this is slow. Better: detect localization failure (high uncertainty, poor scan matching) and trigger relocalization. Some systems use global features (WiFi fingerprints, visual landmarks) for coarse localization, then refine with local sensors.

### Q: Explain loop closure in SLAM
As robot explores, it accumulates drift. Loop closure detects when robot returns to previously visited place - using visual features, scan matching, or place recognition. Then optimizes entire pose graph to make the loop consistent. This redistributes error across the trajectory. Cartographer does this continuously with background optimization.

## System Design Questions

### Q: Design an autonomy stack for a warehouse robot
Perception: 2D lidar for navigation, maybe RGB-D for obstacle detection. Localization: AMCL on pre-built map, with fiducial markers for high-accuracy docking. Planning: Nav2 with Smac planner (handles non-circular footprint), regulated pure pursuit controller. Behavior: BT for task execution - go to pickup, dock, pick, go to dropoff, undock. Safety: bumpers as last resort, emergency stop, speed limiting in congested areas.

### Q: How would you handle GPS-denied navigation?
Indoor: lidar SLAM or visual-inertial odometry. Outdoor urban: combine degraded GPS with visual odometry and IMU. Key is graceful degradation - detect when GPS quality is poor (high HDOP, few satellites) and rely more on other sensors. Tight coupling in the filter helps - don't just switch sources, fuse everything with appropriate uncertainties.

### Q: Design sensor fusion for an autonomous car
Primary: lidar for 3D perception, camera for lane detection and signs, radar for velocity and bad weather. Localization: HD map with GPS/INS, refined by lidar localization against map. State estimation: error-state Kalman filter fusing IMU, wheel odometry, GPS, lidar localization. Run IMU prediction at 100Hz, update with others as available. Critical: time synchronization across all sensors.

## Behavioral Questions

### Q: Tell me about a challenging bug you debugged
[Customize with your experience - include: what the symptom was, your debugging process, root cause, and fix. Good topics: sensor timing issues, tf problems, filter divergence, race conditions in ROS]

### Q: How do you approach testing robotics software?
Unit tests for algorithms (planning, control math). Integration tests in simulation (Gazebo) for full stack. Hardware-in-loop for sensor drivers. Field testing with increasing autonomy - first teleoperated, then supervised autonomy, then full autonomy. Regression testing with recorded data (rosbag playback). Key: simulation can't catch everything, but catches most issues safely.

### Q: Describe a system you designed end-to-end
[Customize with your experience - include: requirements, architecture decisions, tradeoffs you made, results/metrics. Show you understand the full stack, not just one component]
