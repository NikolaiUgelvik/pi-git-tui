function windowsQuotedLength(value) {
    if (value.length > 0 && !/[\s"]/u.test(value))
        return value.length;
    let length = 2;
    let backslashes = 0;
    for (const character of value) {
        if (character === "\\") {
            backslashes++;
            continue;
        }
        if (character === '"') {
            length += backslashes * 2 + 2;
        }
        else {
            length += backslashes + character.length;
        }
        backslashes = 0;
    }
    return length + backslashes * 2;
}
function encodedArgumentBytes(value) {
    const utf8Bytes = Buffer.byteLength(value, "utf8") + 1;
    const conservativeWindowsBytes = (windowsQuotedLength(value) + 1) * 2;
    return Math.max(utf8Bytes, conservativeWindowsBytes);
}
function argumentsBytes(values) {
    return values.reduce((total, value) => total + encodedArgumentBytes(value), 0);
}
export function literalPathsFit(paths, budget, fixedArgs = []) {
    return (paths.length <= budget.argvChunkPaths && argumentsBytes(fixedArgs) + argumentsBytes(paths) <= budget.argvChunkBytes);
}
export function chunkLiteralPaths(paths, budget, fixedArgs = []) {
    const chunks = [];
    let current = [];
    for (const path of paths) {
        if (!literalPathsFit([path], budget, fixedArgs)) {
            throw new Error(`Git path exceeds the configured argument limit: ${JSON.stringify(path)}`);
        }
        if (current.length > 0 && !literalPathsFit([...current, path], budget, fixedArgs)) {
            chunks.push(current);
            current = [];
        }
        current.push(path);
    }
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
function connectedLiteralPathGroups(groups) {
    const parents = groups.map((_group, index) => index);
    const firstGroupByPath = new Map();
    const find = (index) => {
        let root = index;
        while (parents[root] !== root)
            root = parents[root] ?? root;
        while (parents[index] !== index) {
            const next = parents[index] ?? root;
            parents[index] = root;
            index = next;
        }
        return root;
    };
    const union = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot)
            parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    };
    groups.forEach((group, index) => {
        for (const path of new Set(group.paths)) {
            const previous = firstGroupByPath.get(path);
            if (previous === undefined)
                firstGroupByPath.set(path, index);
            else
                union(previous, index);
        }
    });
    const members = new Map();
    groups.forEach((_group, index) => {
        const root = find(index);
        const indexes = members.get(root) ?? [];
        indexes.push(index);
        members.set(root, indexes);
    });
    return [...members.values()].map((indexes) => ({
        values: indexes.flatMap((index) => (groups[index] ? [groups[index].value] : [])),
        paths: [...new Set(indexes.flatMap((index) => groups[index]?.paths ?? []))],
    }));
}
export function chunkLiteralPathGroups(groups, budget, fixedArgs = []) {
    const batches = [];
    const oversized = [];
    let currentValues = [];
    let currentPaths = [];
    for (const component of connectedLiteralPathGroups(groups)) {
        if (!literalPathsFit(component.paths, budget, fixedArgs)) {
            oversized.push(...component.values);
            continue;
        }
        const combinedPaths = [...new Set([...currentPaths, ...component.paths])];
        if (currentValues.length > 0 && !literalPathsFit(combinedPaths, budget, fixedArgs)) {
            batches.push(currentValues);
            currentValues = [];
            currentPaths = [];
        }
        currentValues.push(...component.values);
        currentPaths.push(...component.paths);
    }
    if (currentValues.length > 0)
        batches.push(currentValues);
    return { batches, oversized };
}
export function nulRecords(raw) {
    if (!raw)
        return [];
    const records = raw.split("\0");
    if (records.at(-1) === "")
        records.pop();
    return records;
}
export function pathAfterTab(record) {
    const separator = record.indexOf("\t");
    return separator < 0 ? undefined : record.slice(separator + 1);
}
//# sourceMappingURL=git-path-batches.js.map