import sys

def check(file_path):
    with open(file_path, 'r') as f:
        content = f.read()

    stack = []
    lines = content.split('\n')
    
    for i, line in enumerate(lines):
        # Very crude, ignores comments/strings
        for j, char in enumerate(line):
            if char == '{':
                stack.append((i+1, j+1))
            elif char == '}':
                if not stack:
                    print(f"Extra closing brace at line {i+1}, col {j+1}")
                    return
                stack.pop()

    if stack:
        print(f"Unclosed braces: {stack}")
    else:
        print("Braces matched.")

check('src/app/api/chat/route.ts')
