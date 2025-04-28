#!/bin/bash

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

# Define and create the test run directory *before* the main pipe
mkdir -p "$BASE_TEST_DIR" # Ensure base exists first
TEST_RUN_DIR="$BASE_TEST_DIR/run_$TIMESTAMP"
mkdir -p "$TEST_RUN_DIR"

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

  analyze_log_with_llm() {
    local log_file="$1"
    local provider_summary_log="provider_add_task_summary.log" # File summarizing provider test outcomes
    local api_key=""
    local api_endpoint="https://api.anthropic.com/v1/messages"
    local api_key_name="CLAUDE_API_KEY"

    echo "" # Add a newline before analysis starts
    log_info "Attempting LLM analysis of log: $log_file"

    # Check for jq and curl
    if ! command -v jq &> /dev/null; then
      log_error "LLM Analysis requires 'jq'. Skipping analysis."
      return 1
    fi
    if ! command -v curl &> /dev/null; then
      log_error "LLM Analysis requires 'curl'. Skipping analysis."
      return 1
    fi

    # Check for API Key in the TEST_RUN_DIR/.env (copied earlier)
    if [ -f ".env" ]; then
      # Using grep and sed for better handling of potential quotes/spaces
      api_key=$(grep "^${api_key_name}=" .env | sed -e "s/^${api_key_name}=//" -e 's/^[[:space:]"]*//' -e 's/[[:space:]"]*$//')
    fi

    if [ -z "$api_key" ]; then
      log_error "${api_key_name} not found or empty in .env file in the test run directory ($(pwd)/.env). Skipping LLM analysis."
      return 1
    fi

    if [ ! -f "$log_file" ]; then
      log_error "Log file not found: $log_file. Skipping LLM analysis."
      return 1
    fi

    log_info "Reading log file content..."
    local log_content
    # Read entire file, handle potential errors
    log_content=$(cat "$log_file") || {
      log_error "Failed to read log file: $log_file. Skipping LLM analysis."
      return 1
    }

    # Prepare the prompt
    # Using printf with %s for the log content is generally safer than direct variable expansion
    local prompt_template='Analyze the following E2E test log for the task-master tool. The log contains output from various '\''task-master'\'' commands executed sequentially.\n\nYour goal is to:\n1. Verify if the key E2E steps completed successfully based on the log messages (e.g., init, parse PRD, list tasks, analyze complexity, expand task, set status, manage models, add/remove dependencies, add/update/remove tasks/subtasks, generate files).\n2. **Specifically analyze the Multi-Provider Add-Task Test Sequence:**\n   a. Identify which providers were tested for `add-task`. Look for log steps like "Testing Add-Task with Provider: ..." and the summary log `'"$provider_summary_log"'`.\n   b. For each tested provider, determine if `add-task` succeeded or failed. Note the created task ID if successful.\n   c. Review the corresponding `add_task_show_output_<provider>_id_<id>.log` file (if created) for each successful `add-task` execution.\n   d. **Compare the quality and completeness** of the task generated by each successful provider based on their `show` output. Assign a score (e.g., 1-10, 10 being best) based on relevance to the prompt, detail level, and correctness.\n   e. Note any providers where `add-task` failed or where the task ID could not be extracted.\n3. Identify any general explicit "[ERROR]" messages or stack traces throughout the *entire* log.\n4. Identify any potential warnings or unusual output that might indicate a problem even if not marked as an explicit error.\n5. Provide an overall assessment of the test run'\''s health based *only* on the log content.\n\nReturn your analysis **strictly** in the following JSON format. Do not include any text outside of the JSON structure:\n\n{\n  "overall_status": "Success|Failure|Warning",\n  "verified_steps": [ "Initialization", "PRD Parsing", /* ...other general steps observed... */ ],\n  "provider_add_task_comparison": {\n     "prompt_used": "... (extract from log if possible or state 'standard auth prompt') ...",\n     "provider_results": {\n       "anthropic": { "status": "Success|Failure|ID_Extraction_Failed|Set_Model_Failed", "task_id": "...", "score": "X/10 | N/A", "notes": "..." },\n       "openai": { "status": "Success|Failure|...", "task_id": "...", "score": "X/10 | N/A", "notes": "..." },\n       /* ... include all tested providers ... */\n     },\n     "comparison_summary": "Brief overall comparison of generated tasks..."\n   },\n  "detected_issues": [ { "severity": "Error|Warning|Anomaly", "description": "...", "log_context": "[Optional, short snippet from log near the issue]" } ],\n  "llm_summary_points": [ "Overall summary point 1", "Provider comparison highlight", "Any major issues noted" ]\n}\n\nHere is the main log content:\n\n%s'

    local full_prompt
    printf -v full_prompt "$prompt_template" "$log_content"

    # Construct the JSON payload for Claude Messages API
    # Using jq for robust JSON construction
    local payload
    payload=$(jq -n --arg prompt "$full_prompt" '{
      "model": "claude-3-7-sonnet-20250219", 
      "max_tokens": 10000,
      "messages": [
        {"role": "user", "content": $prompt}
      ],
      "temperature": 0.0
    }') || {
        log_error "Failed to create JSON payload using jq."
        return 1
    }

    log_info "Sending request to LLM API endpoint: $api_endpoint ..."
    local response_raw response_http_code response_body
    # Capture body and HTTP status code separately
    response_raw=$(curl -s -w "\nHTTP_STATUS_CODE:%{http_code}" -X POST "$api_endpoint" \
         -H "Content-Type: application/json" \
         -H "x-api-key: $api_key" \
         -H "anthropic-version: 2023-06-01" \
         --data "$payload")

    # Extract status code and body
    response_http_code=$(echo "$response_raw" | grep '^HTTP_STATUS_CODE:' | sed 's/HTTP_STATUS_CODE://')
    response_body=$(echo "$response_raw" | sed '$d') # Remove last line (status code)

    if [ "$response_http_code" != "200" ]; then
        log_error "LLM API call failed with HTTP status $response_http_code."
        log_error "Response Body: $response_body"
        return 1
    fi

    if [ -z "$response_body" ]; then
        log_error "LLM API call returned empty response body."
        return 1
    fi

    log_info "Received LLM response (HTTP 200). Parsing analysis JSON..."

    # Extract the analysis JSON string from the API response (adjust jq path if needed)
    local analysis_json_string
    analysis_json_string=$(echo "$response_body" | jq -r '.content[0].text' 2>/dev/null) # Assumes Messages API structure

    if [ -z "$analysis_json_string" ]; then
        log_error "Failed to extract 'content[0].text' from LLM response JSON."
        log_error "Full API response body: $response_body"
        return 1
    fi

    # Validate and pretty-print the extracted JSON
    if ! echo "$analysis_json_string" | jq -e . > /dev/null 2>&1; then
        log_error "Extracted content from LLM is not valid JSON."
        log_error "Raw extracted content: $analysis_json_string"
        return 1
    fi

    log_success "LLM analysis completed successfully."
    echo ""
    echo "--- LLM Analysis ---"
    # Pretty print the JSON analysis
    echo "$analysis_json_string" | jq '.'
    echo "--------------------"

    return 0
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

  log_info "Ensured base test directory exists: $BASE_TEST_DIR"

  log_info "Using test run directory (created earlier): $TEST_RUN_DIR"

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

  log_step "Resetting main model to default (Claude Sonnet) before provider tests"
  task-master models --set-main claude-3-7-sonnet-20250219
  log_success "Main model reset to claude-3-7-sonnet-20250219."

  # === End Model Commands Test ===

  # === Multi-Provider Add-Task Test ===
  log_step "Starting Multi-Provider Add-Task Test Sequence"

  # Define providers, models, and flags
  # Array order matters: providers[i] corresponds to models[i] and flags[i]
  declare -a providers=("anthropic" "openai" "google" "perplexity" "xai" "openrouter")
  declare -a models=(
    "claude-3-7-sonnet-20250219"
    "gpt-4o"
    "gemini-2.5-pro-exp-03-25"
    "sonar-pro"
    "grok-3"
    "anthropic/claude-3.7-sonnet" # OpenRouter uses Claude 3.7 
  )
  # Flags: Add provider-specific flags here, e.g., --openrouter. Use empty string if none.
  declare -a flags=("" "" "" "" "" "--openrouter")

  # Consistent prompt for all providers
  add_task_prompt="Create a task to implement user authentication using OAuth 2.0 with Google as the provider. Include steps for registering the app, handling the callback, and storing user sessions."
  log_info "Using consistent prompt for add-task tests: \"$add_task_prompt\""

  for i in "${!providers[@]}"; do
    provider="${providers[$i]}"
    model="${models[$i]}"
    flag="${flags[$i]}"

    log_step "Testing Add-Task with Provider: $provider (Model: $model)"

    # 1. Set the main model for this provider
    log_info "Setting main model to $model for $provider ${flag:+using flag $flag}..."
    set_model_cmd="task-master models --set-main \"$model\" $flag"
    echo "Executing: $set_model_cmd"
    if eval $set_model_cmd; then
      log_success "Successfully set main model for $provider."
    else
      log_error "Failed to set main model for $provider. Skipping add-task for this provider."
      # Optionally save failure info here if needed for LLM analysis
      echo "Provider $provider set-main FAILED" >> provider_add_task_summary.log
      continue # Skip to the next provider
    fi

    # 2. Run add-task
    log_info "Running add-task with prompt..."
    add_task_output_file="add_task_raw_output_${provider}.log"
    # Run add-task and capture ALL output (stdout & stderr) to a file AND a variable
    add_task_cmd_output=$(task-master add-task --prompt "$add_task_prompt" 2>&1 | tee "$add_task_output_file")
    add_task_exit_code=${PIPESTATUS[0]}

    # 3. Check for success and extract task ID
    new_task_id=""
    if [ $add_task_exit_code -eq 0 ] && echo "$add_task_cmd_output" | grep -q "Successfully added task with ID:"; then
      # Attempt to extract the ID (adjust grep/sed/awk as needed based on actual output format)
      new_task_id=$(echo "$add_task_cmd_output" | grep "Successfully added task with ID:" | sed 's/.*Successfully added task with ID: \([0-9.]\+\).*/\1/')
      if [ -n "$new_task_id" ]; then
        log_success "Add-task succeeded for $provider. New task ID: $new_task_id"
        echo "Provider $provider add-task SUCCESS (ID: $new_task_id)" >> provider_add_task_summary.log
      else
        # Succeeded but couldn't parse ID - treat as warning/anomaly
        log_error "Add-task command succeeded for $provider, but failed to extract task ID from output."
        echo "Provider $provider add-task SUCCESS (ID extraction FAILED)" >> provider_add_task_summary.log
        new_task_id="UNKNOWN_ID_EXTRACTION_FAILED"
      fi
    else
      log_error "Add-task command failed for $provider (Exit Code: $add_task_exit_code). See $add_task_output_file for details."
      echo "Provider $provider add-task FAILED (Exit Code: $add_task_exit_code)" >> provider_add_task_summary.log
      new_task_id="FAILED"
    fi

    # 4. Run task show if ID was obtained (even if extraction failed, use placeholder)
    if [ "$new_task_id" != "FAILED" ] && [ "$new_task_id" != "UNKNOWN_ID_EXTRACTION_FAILED" ]; then
      log_info "Running task show for new task ID: $new_task_id"
      show_output_file="add_task_show_output_${provider}_id_${new_task_id}.log"
      if task-master show "$new_task_id" > "$show_output_file"; then
        log_success "Task show output saved to $show_output_file"
      else
        log_error "task show command failed for ID $new_task_id. Check log."
        # Still keep the file, it might contain error output
      fi
    elif [ "$new_task_id" == "UNKNOWN_ID_EXTRACTION_FAILED" ]; then
       log_info "Skipping task show for $provider due to ID extraction failure."
    else
       log_info "Skipping task show for $provider due to add-task failure."
    fi

  done # End of provider loop

  log_step "Finished Multi-Provider Add-Task Test Sequence"
  echo "Provider add-task summary log available at: provider_add_task_summary.log"
  # === End Multi-Provider Add-Task Test ===

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

# --- Attempt LLM Analysis ---
echo "DEBUG: Entering LLM Analysis section..."
# Run this *after* the main execution block and tee pipe finish writing the log file
# It will read the completed log file and append its output to the terminal (and the log via subsequent writes if tee is still active, though it shouldn't be)
# Change directory back into the test run dir where .env is located
if [ -d "$TEST_RUN_DIR" ]; then
  echo "DEBUG: Found TEST_RUN_DIR: $TEST_RUN_DIR. Attempting cd..."
  cd "$TEST_RUN_DIR"
  echo "DEBUG: Changed directory to $(pwd). Calling analyze_log_with_llm..."
  analyze_log_with_llm "$LOG_FILE"
  echo "DEBUG: analyze_log_with_llm function call finished."
  # Optional: cd back again if needed, though script is ending
  # cd "$ORIGINAL_DIR"
else
  # Use log_error format even outside the pipe for consistency
  current_time_for_error=$(date +%s)
  elapsed_seconds_for_error=$((current_time_for_error - overall_start_time)) # Use overall start time
  formatted_duration_for_error=$(_format_duration "$elapsed_seconds_for_error")
  echo "[ERROR] [$formatted_duration_for_error] $(date +"%Y-%m-%d %H:%M:%S") Test run directory $TEST_RUN_DIR not found. Cannot perform LLM analysis." >&2
fi

echo "DEBUG: Reached end of script before final exit."
exit $EXIT_CODE # Exit with the status of the main script block