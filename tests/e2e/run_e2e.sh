#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e
# Treat unset variables as an error when substituting.
set -u
# Prevent errors in pipelines from being masked.
set -o pipefail

# --- Configuration ---
# Assumes script is run from the project root (claude-task-master)
TASKMASTER_SOURCE_DIR="." # Current directory is the source
# Base directory for test runs, relative to project root
BASE_TEST_DIR="$TASKMASTER_SOURCE_DIR/tests/e2e/_runs"
# Log directory, relative to project root
LOG_DIR="$TASKMASTER_SOURCE_DIR/tests/e2e/log"
# Path to the sample PRD, relative to project root
SAMPLE_PRD_SOURCE="$TASKMASTER_SOURCE_DIR/tests/fixtures/sample-prd.txt"
# Path to the main .env file in the source directory
MAIN_ENV_FILE="$TASKMASTER_SOURCE_DIR/.env"
# ---

# --- Test State Variables ---
# Note: These are mainly for step numbering within the log now, not for final summary
test_step_count=0
start_time_for_helpers=0 # Separate start time for helper functions inside the pipe
# ---

# --- Log File Setup ---
# Create the log directory if it doesn't exist
mkdir -p "$LOG_DIR"
# Define timestamped log file path
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/e2e_run_$TIMESTAMP.log"

# Echo starting message to the original terminal BEFORE the main piped block
echo "Starting E2E test. Output will be shown here and saved to: $LOG_FILE"
echo "Running from directory: $(pwd)"
echo "--- Starting E2E Run ---" # Separator before piped output starts

# Record start time for overall duration *before* the pipe
overall_start_time=$(date +%s)

# --- Main Execution Block (Piped to tee) ---
# Wrap the main part of the script in braces and pipe its output (stdout and stderr) to tee
{
  # Record start time for helper functions *inside* the pipe
  start_time_for_helpers=$(date +%s)

  # --- Helper Functions (Output will now go to tee -> terminal & log file) ---
  _format_duration() {
    local total_seconds=$1
    local minutes=$((total_seconds / 60))
    local seconds=$((total_seconds % 60))
    printf "%dm%02ds" "$minutes" "$seconds"
  }

  _get_elapsed_time_for_log() {
    local current_time=$(date +%s)
    local elapsed_seconds=$((current_time - start_time_for_helpers))
    _format_duration "$elapsed_seconds"
  }

  log_info() {
    echo "[INFO] [$(_get_elapsed_time_for_log)] $(date +"%Y-%m-%d %H:%M:%S") $1"
  }

  log_success() {
    # We no longer increment success_step_count here for the final summary
    echo "[SUCCESS] [$(_get_elapsed_time_for_log)] $(date +"%Y-%m-%d %H:%M:%S") $1"
  }

  log_error() {
    # Output errors to stderr, which gets merged and sent to tee
    echo "[ERROR] [$(_get_elapsed_time_for_log)] $(date +"%Y-%m-%d %H:%M:%S") $1" >&2
  }

  log_step() {
    test_step_count=$((test_step_count + 1))
    echo ""
    echo "============================================="
    echo "  STEP ${test_step_count}: [$(_get_elapsed_time_for_log)] $(date +"%Y-%m-%d %H:%M:%S") $1"
    echo "============================================="
  }
  # ---

  # --- Test Setup (Output to tee) ---
  log_step "Setting up test environment"

  log_step "Creating global npm link for task-master-ai"
  if npm link; then
    log_success "Global link created/updated."
  else
    log_error "Failed to run 'npm link'. Check permissions or output for details."
    exit 1
  fi

  mkdir -p "$BASE_TEST_DIR"
  log_info "Ensured base test directory exists: $BASE_TEST_DIR"

  TEST_RUN_DIR="$BASE_TEST_DIR/run_$TIMESTAMP"
  mkdir -p "$TEST_RUN_DIR"
  log_info "Created test run directory: $TEST_RUN_DIR"

  # Check if source .env file exists
  if [ ! -f "$MAIN_ENV_FILE" ]; then
      log_error "Source .env file not found at $MAIN_ENV_FILE. Cannot proceed with API-dependent tests."
      exit 1
  fi
  log_info "Source .env file found at $MAIN_ENV_FILE."

  # Check if sample PRD exists
  if [ ! -f "$SAMPLE_PRD_SOURCE" ]; then
    log_error "Sample PRD not found at $SAMPLE_PRD_SOURCE. Please check path."
    exit 1
  fi

  log_info "Copying sample PRD to test directory..."
  cp "$SAMPLE_PRD_SOURCE" "$TEST_RUN_DIR/prd.txt"
  if [ ! -f "$TEST_RUN_DIR/prd.txt" ]; then
    log_error "Failed to copy sample PRD to $TEST_RUN_DIR."
    exit 1
  fi
  log_success "Sample PRD copied."

  ORIGINAL_DIR=$(pwd) # Save original dir
  cd "$TEST_RUN_DIR"
  log_info "Changed directory to $(pwd)"

  # === Copy .env file BEFORE init ===
  log_step "Copying source .env file for API keys"
  if cp "$ORIGINAL_DIR/.env" ".env"; then
    log_success ".env file copied successfully."
  else
    log_error "Failed to copy .env file from $ORIGINAL_DIR/.env"
    exit 1
  fi
  # ========================================

  # --- Test Execution (Output to tee) ---

  log_step "Linking task-master-ai package locally"
  npm link task-master-ai
  log_success "Package linked locally."

  log_step "Initializing Task Master project (non-interactive)"
  task-master init -y --name="E2E Test $TIMESTAMP" --description="Automated E2E test run"
  if [ ! -f ".taskmasterconfig" ] || [ ! -f "package.json" ]; then
    log_error "Initialization failed: .taskmasterconfig or package.json not found."
    exit 1
  fi
  log_success "Project initialized."

  log_step "Parsing PRD"
  task-master parse-prd ./prd.txt --force
  if [ ! -s "tasks/tasks.json" ]; then
    log_error "Parsing PRD failed: tasks/tasks.json not found or is empty."
    exit 1
  fi
  log_success "PRD parsed successfully."

  log_step "Listing tasks"
  task-master list > task_list_output.log
  log_success "Task list saved to task_list_output.log"

  log_step "Analyzing complexity"
  # Add --research flag if needed and API keys support it
  task-master analyze-complexity --research --output complexity_results.json
  if [ ! -f "complexity_results.json" ]; then
    log_error "Complexity analysis failed: complexity_results.json not found."
    exit 1
  fi
  log_success "Complexity analysis saved to complexity_results.json"

  log_step "Generating complexity report"
  task-master complexity-report --file complexity_results.json > complexity_report_formatted.log
  log_success "Formatted complexity report saved to complexity_report_formatted.log"

  log_step "Expanding Task 1 (assuming it exists)"
  # Add --research flag if needed and API keys support it
  task-master expand --id=1 # Add --research?
  log_success "Attempted to expand Task 1."

  log_step "Setting status for Subtask 1.1 (assuming it exists)"
  task-master set-status --id=1.1 --status=done
  log_success "Attempted to set status for Subtask 1.1 to 'done'."

  log_step "Listing tasks again (after changes)"
  task-master list --with-subtasks > task_list_after_changes.log
  log_success "Task list after changes saved to task_list_after_changes.log"

  # === Test Model Commands ===
  log_step "Checking initial model configuration"
  task-master models > models_initial_config.log
  log_success "Initial model config saved to models_initial_config.log"

  log_step "Setting main model"
  task-master models --set-main claude-3-7-sonnet-20250219
  log_success "Set main model."

  log_step "Setting research model"
  task-master models --set-research sonar-pro
  log_success "Set research model."

  log_step "Setting fallback model"
  task-master models --set-fallback claude-3-5-sonnet-20241022
  log_success "Set fallback model."

  log_step "Checking final model configuration"
  task-master models > models_final_config.log
  log_success "Final model config saved to models_final_config.log"
  # === End Model Commands Test ===

  log_step "Listing tasks again (final)"
  task-master list --with-subtasks > task_list_final.log
  log_success "Final task list saved to task_list_final.log"

  # === Test Core Task Commands ===
  log_step "Listing tasks (initial)"
  task-master list > task_list_initial.log
  log_success "Initial task list saved to task_list_initial.log"

  log_step "Getting next task"
  task-master next > next_task_initial.log
  log_success "Initial next task saved to next_task_initial.log"

  log_step "Showing Task 1 details"
  task-master show 1 > task_1_details.log
  log_success "Task 1 details saved to task_1_details.log"

  log_step "Adding dependency (Task 2 depends on Task 1)"
  task-master add-dependency --id=2 --depends-on=1
  log_success "Added dependency 2->1."

  log_step "Validating dependencies (after add)"
  task-master validate-dependencies > validate_dependencies_after_add.log
  log_success "Dependency validation after add saved."

  log_step "Removing dependency (Task 2 depends on Task 1)"
  task-master remove-dependency --id=2 --depends-on=1
  log_success "Removed dependency 2->1."

  log_step "Fixing dependencies (should be no-op now)"
  task-master fix-dependencies > fix_dependencies_output.log
  log_success "Fix dependencies attempted."

  log_step "Adding Task 11 (Manual)"
  task-master add-task --title="Manual E2E Task" --description="Add basic health check endpoint" --priority=low --dependencies=3 # Depends on backend setup
  # Assuming the new task gets ID 11 (adjust if PRD parsing changes)
  log_success "Added Task 11 manually."

  log_step "Adding Task 12 (AI)"
  task-master add-task --prompt="Implement basic UI styling using CSS variables for colors and spacing" --priority=medium --dependencies=1 # Depends on frontend setup
  # Assuming the new task gets ID 12
  log_success "Added Task 12 via AI prompt."

  log_step "Updating Task 3 (update-task AI)"
  task-master update-task --id=3 --prompt="Update backend server setup: Ensure CORS is configured to allow requests from the frontend origin."
  log_success "Attempted update for Task 3."

  log_step "Updating Tasks from Task 5 (update AI)"
  task-master update --from=5 --prompt="Refactor the backend storage module to use a simple JSON file (storage.json) instead of an in-memory object for persistence. Update relevant tasks."
  log_success "Attempted update from Task 5 onwards."

  log_step "Expanding Task 8 (AI)"
  task-master expand --id=8 # Expand task 8: Frontend logic
  log_success "Attempted to expand Task 8."

  log_step "Updating Subtask 8.1 (update-subtask AI)"
  task-master update-subtask --id=8.1 --prompt="Implementation note: Remember to handle potential API errors and display a user-friendly message."
  log_success "Attempted update for Subtask 8.1."

  # Add a couple more subtasks for multi-remove test
  log_step "Adding subtasks to Task 2 (for multi-remove test)"
  task-master add-subtask --parent=2 --title="Subtask 2.1 for removal"
  task-master add-subtask --parent=2 --title="Subtask 2.2 for removal"
  log_success "Added subtasks 2.1 and 2.2."

  log_step "Removing Subtasks 2.1 and 2.2 (multi-ID)"
  task-master remove-subtask --id=2.1,2.2
  log_success "Removed subtasks 2.1 and 2.2."

  log_step "Setting status for Task 1 to done"
  task-master set-status --id=1 --status=done
  log_success "Set status for Task 1 to done."

  log_step "Getting next task (after status change)"
  task-master next > next_task_after_change.log
  log_success "Next task after change saved to next_task_after_change.log"

  log_step "Clearing subtasks from Task 8"
  task-master clear-subtasks --id=8
  log_success "Attempted to clear subtasks from Task 8."

  log_step "Removing Tasks 11 and 12 (multi-ID)"
  # Remove the tasks we added earlier
  task-master remove-task --id=11,12 -y
  log_success "Removed tasks 11 and 12."

  log_step "Generating task files (final)"
  task-master generate
  log_success "Generated task files."
  # === End Core Task Commands Test ===

  # === AI Commands (Tested earlier implicitly with add/update/expand) ===
  log_step "Analyzing complexity (AI with Research)"
  task-master analyze-complexity --research --output complexity_results.json
  if [ ! -f "complexity_results.json" ]; then log_error "Complexity analysis failed."; exit 1; fi
  log_success "Complexity analysis saved to complexity_results.json"

  log_step "Generating complexity report (Non-AI)"
  task-master complexity-report --file complexity_results.json > complexity_report_formatted.log
  log_success "Formatted complexity report saved to complexity_report_formatted.log"

  # Expand All (Commented Out)
  # log_step "Expanding All Tasks (AI - Heavy Operation, Commented Out)"
  # task-master expand --all --research
  # log_success "Attempted to expand all tasks."

  log_step "Expanding Task 1 (AI - Note: Subtasks were removed/cleared)"
  task-master expand --id=1
  log_success "Attempted to expand Task 1 again."
  # === End AI Commands ===

  log_step "Listing tasks again (final)"
  task-master list --with-subtasks > task_list_final.log
  log_success "Final task list saved to task_list_final.log"

  # --- Test Completion (Output to tee) ---
  log_step "E2E Test Steps Completed"
  echo ""
  ABS_TEST_RUN_DIR="$(pwd)"
  echo "Test artifacts and logs are located in: $ABS_TEST_RUN_DIR"
  echo "Key artifact files (within above dir):"
  echo "  - .env (Copied from source)"
  echo "  - tasks/tasks.json"
  echo "  - task_list_output.log"
  echo "  - complexity_results.json"
  echo "  - complexity_report_formatted.log"
  echo "  - task_list_after_changes.log"
  echo "  - models_initial_config.log, models_final_config.log"
  echo "  - task_list_final.log"
  echo "  - task_list_initial.log, next_task_initial.log, task_1_details.log"
  echo "  - validate_dependencies_after_add.log, fix_dependencies_output.log"
  echo "  - complexity_*.log"
  echo ""
  echo "Full script log also available at: $LOG_FILE (relative to project root)"

  # Optional: cd back to original directory
  # cd "$ORIGINAL_DIR"

# End of the main execution block brace
} 2>&1 | tee "$LOG_FILE"

# --- Final Terminal Message ---
EXIT_CODE=${PIPESTATUS[0]}
overall_end_time=$(date +%s)
total_elapsed_seconds=$((overall_end_time - overall_start_time))

# Format total duration
total_minutes=$((total_elapsed_seconds / 60))
total_sec_rem=$((total_elapsed_seconds % 60))
formatted_total_time=$(printf "%dm%02ds" "$total_minutes" "$total_sec_rem")

# Count steps and successes from the log file *after* the pipe finishes
# Use grep -c for counting lines matching the pattern
final_step_count=$(grep -c '^==.* STEP [0-9]\+:' "$LOG_FILE" || true) # Count lines starting with === STEP X:
final_success_count=$(grep -c '\[SUCCESS\]' "$LOG_FILE" || true) # Count lines containing [SUCCESS]

echo "--- E2E Run Summary ---"
echo "Log File: $LOG_FILE"
echo "Total Elapsed Time: ${formatted_total_time}"
echo "Total Steps Executed: ${final_step_count}" # Use count from log

if [ $EXIT_CODE -eq 0 ]; then
    echo "Status: SUCCESS"
    # Use counts from log file
    echo "Successful Steps: ${final_success_count}/${final_step_count}"
else
    echo "Status: FAILED"
    # Use count from log file for total steps attempted
    echo "Failure likely occurred during/after Step: ${final_step_count}"
    # Use count from log file for successes before failure
    echo "Successful Steps Before Failure: ${final_success_count}"
    echo "Please check the log file '$LOG_FILE' for error details."
fi
echo "-------------------------"

exit $EXIT_CODE # Exit with the status of the main script block