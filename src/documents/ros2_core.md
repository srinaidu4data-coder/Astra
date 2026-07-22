# ROS2 Core Concepts for Interviews

## Communication Patterns

### Topics (Pub/Sub)
- Asynchronous, many-to-many communication
- Best for: sensor data streams, state updates, telemetry
- QoS profiles: reliable vs best-effort, durability, history depth
- Example: `/scan` (LaserScan), `/odom` (Odometry), `/cmd_vel` (Twist)

### Services (Request/Response)
- Synchronous, one-to-one communication
- Best for: discrete operations, configuration changes
- Blocks caller until response received
- Example: `/spawn`, `/set_parameters`, `/trigger_landing`

### Actions (Goal/Feedback/Result)
- Long-running tasks with progress feedback
- Supports preemption (cancel ongoing goals)
- Best for: navigation, manipulation, any multi-step task
- Example: `NavigateToPose`, `FollowPath`, `GripperCommand`

## Node Lifecycle (Managed Nodes)

States: Unconfigured -> Inactive -> Active -> Finalized

- `on_configure()`: Load parameters, allocate memory, setup publishers
- `on_activate()`: Start processing, enable outputs
- `on_deactivate()`: Stop processing, maintain state
- `on_cleanup()`: Release resources, return to unconfigured
- `on_shutdown()`: Final cleanup before destruction

Benefits: Deterministic startup/shutdown, coordinated bringup, error recovery

## Transforms (tf2)

### Core Concepts
- Transform tree: directed acyclic graph of coordinate frames
- Static vs dynamic transforms
- Buffer: stores recent transforms (default 10s)
- Listener: queries transforms between frames
- Broadcaster: publishes transforms

### Common Frames
- `map`: global fixed frame (SLAM origin)
- `odom`: continuous but drifting frame
- `base_link`: robot body frame
- `base_footprint`: 2D projection on ground
- Sensor frames: `camera_link`, `lidar_link`, `imu_link`

### Best Practices
- Always use `tf2_ros::Buffer::transform()` not manual math
- Handle `LookupException`, `ExtrapolationException`
- Use `waitForTransform()` with timeout
- Publish static transforms via `static_transform_publisher`

## Launch System

### Python Launch Files
```python
from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration

def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),
        Node(
            package='my_package',
            executable='my_node',
            parameters=[{'use_sim_time': LaunchConfiguration('use_sim_time')}],
            remappings=[('/input', '/sensor/data')],
        ),
    ])
```

### Key Features
- Composable nodes (same process, zero-copy)
- Parameter files (YAML)
- Conditional execution
- Event handlers

## Parameters

- Declared in node with type and description
- Can have constraints (ranges, enums)
- Runtime reconfigurable via `/set_parameters` service
- Loaded from YAML files or command line
- Parameter events published on `/parameter_events`

## Quality of Service (QoS)

### Profiles
- **Sensor Data**: Best effort, volatile, small queue
- **Parameters**: Reliable, transient local
- **Services**: Reliable
- **Default**: Reliable, volatile, queue=10

### Key Settings
- Reliability: RELIABLE vs BEST_EFFORT
- Durability: VOLATILE vs TRANSIENT_LOCAL
- History: KEEP_LAST(n) vs KEEP_ALL
- Deadline, lifespan, liveliness

### Debugging QoS Mismatches
- `ros2 topic info -v /topic_name` shows QoS
- Publisher and subscriber must be compatible
- RELIABLE pub + BEST_EFFORT sub = OK
- BEST_EFFORT pub + RELIABLE sub = FAIL (no connection)

## Executors

- **SingleThreadedExecutor**: One callback at a time
- **MultiThreadedExecutor**: Parallel callbacks (need thread safety)
- **StaticSingleThreadedExecutor**: Optimized, fixed node set

Callback groups:
- MutuallyExclusive: No parallel execution within group
- Reentrant: Allows parallel execution

## Common Debugging Commands

```bash
# Introspection
ros2 node list
ros2 topic list / echo / hz / bw / info -v
ros2 service list / call
ros2 action list / info

# Parameters
ros2 param list /node_name
ros2 param get /node_name param_name
ros2 param set /node_name param_name value

# Transforms
ros2 run tf2_tools view_frames  # generates PDF
ros2 run tf2_ros tf2_echo frame1 frame2

# Recording/playback
ros2 bag record -a  # all topics
ros2 bag play bagfile.db3 --clock

# Component introspection
ros2 component list
ros2 doctor --report
```

## Colcon Build System

```bash
colcon build --packages-select my_package
colcon build --symlink-install  # faster iteration
colcon test --packages-select my_package
source install/setup.bash
```

## Message Types (Common)

- `geometry_msgs/Twist`: Linear + angular velocity
- `geometry_msgs/PoseStamped`: Position + orientation + header
- `sensor_msgs/LaserScan`: 2D lidar data
- `sensor_msgs/PointCloud2`: 3D point cloud
- `sensor_msgs/Image`: Camera image
- `sensor_msgs/Imu`: Accelerometer + gyroscope
- `nav_msgs/Odometry`: Pose + velocity + covariances
- `nav_msgs/Path`: Sequence of poses
- `nav_msgs/OccupancyGrid`: 2D costmap
