---
'task-master-ai': patch
---

Improved update-subtask
    - Now it has context about the parent task details
    - It also has context about the subtask before it and the subtask after it (if they exist)
    - Not passing all subtasks to stay token efficient
