# Robotics/ROS2/GNC Interview Specialization

This branch customizes Astra Interview Copilot for **Robotics and Autonomy Engineering** interviews, with focus on:
- ROS2 development
- GNC (Guidance, Navigation, Control)
- State estimation and sensor fusion
- Path planning and control
- System design for autonomous robots

## Quick Start

### 1. Customize Your Experience

Edit `docs/robotics/my_projects_template.md` with your actual experience:
- Your projects with specific metrics
- Technologies you've used
- Debugging war stories
- System designs you've created

### 2. Ingest the Knowledge Base

```bash
# Ingest the robotics reference documents
python ingest.py docs/robotics/

# Or via the GUI: Settings > Ingest Documents > Select docs/robotics/
```

### 3. (Optional) Add More Documents

Add any additional documents to `docs/robotics/`:
- Your resume in markdown format
- Company-specific research
- Technical papers you want to reference
- Additional Q&A for specific topics

Then re-run ingestion.

## What's Included

### Reference Documents

| File | Purpose |
|------|---------|
| `ros2_core.md` | ROS2 concepts: topics, services, actions, tf2, lifecycle, QoS |
| `gnc_fundamentals.md` | State estimation, SLAM, path planning, control theory |
| `common_questions.md` | Common interview Q&A with suggested approaches |
| `system_design.md` | Autonomy stack architectures and design patterns |
| `my_projects_template.md` | **Template for YOUR experience** (customize this!) |

### Customized Prompts

The prompts in `config.py` are tuned for robotics:
- **Classification**: Recognizes robotics-specific question types
- **Bullets**: Uses ROS2/GNC terminology (EKF, Nav2, tf2, etc.)
- **Scripts**: Generates answers with robotics examples and terminology

### Default Job Context

Pre-filled with typical robotics/autonomy role context:
```
Role: Robotics / Autonomy Engineer (GNC focus)
Stack: ROS2, C++, Python, Gazebo, Nav2
Domains: State estimation, path planning, control systems, sensor fusion
```

Edit in the app or in `%APPDATA%/astra/prompts.yaml` (Windows) or `~/.config/astra/prompts.yaml` (Linux/Mac).

## Tips for Best Results

### 1. Personalize Your Experience
The generic reference documents provide technical foundations, but **your answers will be much better if you customize `my_projects_template.md`** with:
- Specific projects and metrics ("reduced localization drift by 40%")
- Technologies you actually used
- Real debugging stories
- Concrete system designs

### 2. Add Company-Specific Context
Before an interview, add a document about the company:
```markdown
# Target Company: [Company Name]

## Their Stack
- [Technologies they use]
- [Robot platforms]

## Role Focus
- [What the role emphasizes]

## Talking Points
- [How your experience maps to their needs]
```

### 3. Practice Common Questions
The `common_questions.md` file has approaches for typical questions. Read through it before your interview to internalize the structure.

### 4. Adjust Tone
Use the tone selector in the app:
- **Professional**: Default, good for most interviews
- **Confident**: For senior roles or when you want to sound more assertive
- **Casual**: For startups or informal conversations

## Updating the Knowledge Base

To update after adding/modifying documents:

```bash
# Clear existing embeddings (optional, for clean slate)
rm -rf chroma_db/

# Re-ingest all documents
python ingest.py docs/robotics/
```

## Customizing Prompts

If the default prompts don't fit your style, edit `prompts.yaml`:

**Linux/Mac**: `~/.config/astra/prompts.yaml`
**Windows**: `%APPDATA%\astra\prompts.yaml`

Or reset to defaults by deleting the file - it will be recreated on next launch.
