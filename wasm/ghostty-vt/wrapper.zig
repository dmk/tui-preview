const std = @import("std");

const ghostty_vt = @import("ghostty_vt");

const alloc = std.heap.wasm_allocator;

pub const std_options: std.Options = .{
    .log_level = .err,
    .logFn = wasmLogFn,
};

fn wasmLogFn(
    comptime level: std.log.Level,
    comptime scope: @Type(.enum_literal),
    comptime format: []const u8,
    args: anytype,
) void {
    _ = level;
    _ = scope;
    _ = format;
    _ = args;
}

const cell_bytes = 16;
const config_bytes = 80;
const default_tab_width = 8;

const flag_bold: u8 = 1 << 0;
const flag_italic: u8 = 1 << 1;
const flag_underline: u8 = 1 << 2;
const flag_fg_explicit: u8 = 1 << 3;
const flag_inverse: u8 = 1 << 4;
const flag_invisible: u8 = 1 << 5;
const flag_bg_explicit: u8 = 1 << 6;
const flag_faint: u8 = 1 << 7;

const Rgb = struct {
    r: u8 = 0,
    g: u8 = 0,
    b: u8 = 0,
};

const TerminalConfig = extern struct {
    max_scrollback: u32,
    fg_color: u32,
    bg_color: u32,
    cursor_color: u32,
    palette: [16]u32,
};

const EncodedCell = extern struct {
    codepoint: u32 = 0,
    fg_r: u8 = 0,
    fg_g: u8 = 0,
    fg_b: u8 = 0,
    bg_r: u8 = 0,
    bg_g: u8 = 0,
    bg_b: u8 = 0,
    flags: u8 = 0,
    width: u8 = 0,
    reserved: [4]u8 = .{ 0, 0, 0, 0 },
};

comptime {
    std.debug.assert(@sizeOf(TerminalConfig) == config_bytes);
    std.debug.assert(@sizeOf(EncodedCell) == cell_bytes);
}

const StyleState = struct {
    bold: bool = false,
    italic: bool = false,
    underline: bool = false,
    inverse: bool = false,
    invisible: bool = false,
    faint: bool = false,
    fg: ?Rgb = null,
    bg: ?Rgb = null,
};

const Handler = struct {
    term: *anyopaque,

    fn terminal(self: *Handler) *TerminalHandle {
        return @ptrCast(@alignCast(self.term));
    }

    pub fn deinit(self: *Handler) void {
        _ = self;
    }

    pub fn vt(
        self: *Handler,
        comptime action: ghostty_vt.StreamAction.Tag,
        value: ghostty_vt.StreamAction.Value(action),
    ) !void {
        var term = self.terminal();
        switch (action) {
            .print => term.putCodepoint(value.cp),
            .print_repeat => {
                const count = @max(value, 1);
                for (0..count) |_| term.putCodepoint(term.last_codepoint);
            },
            .backspace => term.backspace(),
            .carriage_return => term.carriageReturn(),
            .linefeed, .index => term.linefeed(),
            .next_line => {
                term.linefeed();
                term.cursor_x = 0;
            },
            .reverse_index => term.reverseIndex(),
            .cursor_up => term.moveCursorRelative(0, -@as(i32, @intCast(value.value))),
            .cursor_down => term.moveCursorRelative(0, @intCast(value.value)),
            .cursor_left => term.moveCursorRelative(-@as(i32, @intCast(value.value)), 0),
            .cursor_right => term.moveCursorRelative(@intCast(value.value), 0),
            .cursor_pos => term.setCursorPos(value.row, value.col),
            .cursor_col => term.setCursorCol(value.value),
            .cursor_row => term.setCursorRow(value.value),
            .cursor_col_relative => term.moveCursorRelative(@intCast(value.value), 0),
            .cursor_row_relative => term.moveCursorRelative(0, @intCast(value.value)),
            .erase_display_below => term.eraseDisplay(.below),
            .erase_display_above => term.eraseDisplay(.above),
            .erase_display_complete => term.eraseDisplay(.complete),
            .erase_display_scrollback => {},
            .erase_display_scroll_complete => term.eraseDisplay(.complete),
            .erase_line_right => term.eraseLine(.right),
            .erase_line_left => term.eraseLine(.left),
            .erase_line_complete => term.eraseLine(.complete),
            .erase_line_right_unless_pending_wrap => term.eraseLine(.right),
            .delete_chars => term.deleteChars(value),
            .erase_chars => term.eraseChars(value),
            .insert_lines => term.insertLines(value),
            .insert_blanks => term.insertBlanks(value),
            .delete_lines => term.deleteLines(value),
            .scroll_up => term.scrollUp(value),
            .scroll_down => term.scrollDown(value),
            .horizontal_tab => term.horizontalTab(value),
            .horizontal_tab_back => term.horizontalTabBack(value),
            .tab_clear_current, .tab_clear_all, .tab_set, .tab_reset => {},
            .set_mode => term.setMode(value.mode, true),
            .reset_mode => term.setMode(value.mode, false),
            .save_mode, .restore_mode, .request_mode, .request_mode_unknown => {},
            .save_cursor => {
                term.saved_x = term.cursor_x;
                term.saved_y = term.cursor_y;
            },
            .restore_cursor => {
                term.cursor_x = term.saved_x;
                term.cursor_y = term.saved_y;
                term.clampCursor();
            },
            .set_attribute => term.applyAttribute(value),
            .device_status => term.handleDeviceStatus(value.request),
            .size_report => term.handleSizeReport(value),
            .device_attributes => term.handleDeviceAttributes(value),
            .full_reset => term.fullReset(),
            .window_title,
            .report_pwd,
            .xtversion,
            .kitty_keyboard_query,
            .kitty_keyboard_push,
            .kitty_keyboard_pop,
            .kitty_keyboard_set,
            .kitty_keyboard_set_or,
            .kitty_keyboard_set_not,
            .modify_key_format,
            .mouse_shift_capture,
            .protected_mode_off,
            .protected_mode_iso,
            .protected_mode_dec,
            => {},
            .top_and_bottom_margin => term.setTopAndBottomMargin(value.top_left, value.bottom_right),
            .left_and_right_margin => term.setLeftAndRightMargin(value.top_left, value.bottom_right),
            .left_and_right_margin_ambiguous => term.handleAmbiguousMargin(),
            .cursor_style,
            .invoke_charset,
            .configure_charset,
            .active_status_display,
            .decaln,
            .start_hyperlink,
            .end_hyperlink,
            .semantic_prompt,
            .mouse_shape,
            .color_operation,
            .kitty_color_report,
            .show_desktop_notification,
            .progress_report,
            .clipboard_contents,
            .title_push,
            .title_pop,
            .dcs_hook,
            .dcs_put,
            .dcs_unhook,
            .apc_start,
            .apc_end,
            .apc_put,
            .bell,
            .enquiry,
            => {},
        }
    }
};

const Stream = ghostty_vt.Stream(Handler);

const TerminalHandle = struct {
    cols: usize,
    rows: usize,
    cursor_x: usize = 0,
    cursor_y: usize = 0,
    saved_x: usize = 0,
    saved_y: usize = 0,
    wraparound: bool = true,
    pending_wrap: bool = false,
    origin_mode: bool = false,
    enable_left_right_margin: bool = false,
    style: StyleState = .{},
    last_codepoint: u21 = ' ',
    default_fg: Rgb = .{ .r = 169, .g = 177, .b = 214 },
    default_bg: Rgb = .{ .r = 26, .g = 27, .b = 38 },
    cursor_color: Rgb = .{ .r = 192, .g = 202, .b = 245 },
    palette: [16]Rgb = defaultPalette(),
    cells: []EncodedCell,
    dirty_rows: []bool,
    dirty_any: bool = true,
    responses: std.ArrayListUnmanaged(u8) = .empty,
    stream: Stream = undefined,
    scroll_top: usize = 0,
    scroll_bottom: usize = 0,
    scroll_left: usize = 0,
    scroll_right: usize = 0,

    const EraseDisplayMode = enum { below, above, complete };
    const EraseLineMode = enum { right, left, complete };

    fn defaultPalette() [16]Rgb {
        return .{
            .{ .r = 21, .g = 22, .b = 30 },
            .{ .r = 247, .g = 118, .b = 142 },
            .{ .r = 158, .g = 206, .b = 106 },
            .{ .r = 224, .g = 175, .b = 104 },
            .{ .r = 122, .g = 162, .b = 247 },
            .{ .r = 187, .g = 154, .b = 247 },
            .{ .r = 125, .g = 207, .b = 255 },
            .{ .r = 169, .g = 177, .b = 214 },
            .{ .r = 65, .g = 72, .b = 104 },
            .{ .r = 247, .g = 118, .b = 142 },
            .{ .r = 158, .g = 206, .b = 106 },
            .{ .r = 224, .g = 175, .b = 104 },
            .{ .r = 122, .g = 162, .b = 247 },
            .{ .r = 187, .g = 154, .b = 247 },
            .{ .r = 125, .g = 207, .b = 255 },
            .{ .r = 192, .g = 202, .b = 245 },
        };
    }

    fn deinit(self: *TerminalHandle) void {
        self.stream.deinit();
        self.responses.deinit(alloc);
        alloc.free(self.dirty_rows);
        alloc.free(self.cells);
    }

    fn resize(self: *TerminalHandle, cols_raw: u32, rows_raw: u32) void {
        const cols = clampDimension(cols_raw);
        const rows = clampDimension(rows_raw);
        if (cols == self.cols and rows == self.rows) return;

        const count = std.math.mul(usize, cols, rows) catch return;
        const cells_new = alloc.alloc(EncodedCell, count) catch return;
        errdefer alloc.free(cells_new);
        const dirty_new = alloc.alloc(bool, rows) catch return;

        @memset(cells_new, EncodedCell{});
        @memset(dirty_new, true);

        alloc.free(self.cells);
        alloc.free(self.dirty_rows);
        self.cells = cells_new;
        self.dirty_rows = dirty_new;
        self.cols = cols;
        self.rows = rows;
        self.resetScrollRegion();
        self.clampCursor();
        self.pending_wrap = false;
        self.dirty_any = true;
    }

    fn clampCursor(self: *TerminalHandle) void {
        if (self.cols == 0 or self.rows == 0) {
            self.cursor_x = 0;
            self.cursor_y = 0;
            return;
        }
        if (self.cursor_x >= self.cols) self.cursor_x = self.cols - 1;
        if (self.cursor_y >= self.rows) self.cursor_y = self.rows - 1;
    }

    fn index(self: *const TerminalHandle, x: usize, y: usize) usize {
        return y * self.cols + x;
    }

    fn rowSlice(self: *TerminalHandle, y: usize) []EncodedCell {
        const start = self.index(0, y);
        return self.cells[start .. start + self.cols];
    }

    fn markRowDirty(self: *TerminalHandle, row: usize) void {
        if (row >= self.rows) return;
        self.dirty_rows[row] = true;
        self.dirty_any = true;
    }

    fn markAllDirty(self: *TerminalHandle) void {
        @memset(self.dirty_rows, true);
        self.dirty_any = true;
    }

    fn resetScrollRegion(self: *TerminalHandle) void {
        self.scroll_top = 0;
        self.scroll_left = 0;
        if (self.rows == 0) {
            self.scroll_bottom = 0;
        } else {
            self.scroll_bottom = self.rows - 1;
        }
        if (self.cols == 0) {
            self.scroll_right = 0;
        } else {
            self.scroll_right = self.cols - 1;
        }
    }

    fn activeScrollLeft(self: *const TerminalHandle) usize {
        if (self.enable_left_right_margin) return self.scroll_left;
        return 0;
    }

    fn activeScrollRight(self: *const TerminalHandle) usize {
        if (self.cols == 0) return 0;
        if (self.enable_left_right_margin) return self.scroll_right;
        return self.cols - 1;
    }

    fn cursorInVerticalRegion(self: *const TerminalHandle) bool {
        return self.cursor_y >= self.scroll_top and self.cursor_y <= self.scroll_bottom;
    }

    fn cursorInHorizontalRegion(self: *const TerminalHandle) bool {
        const left = self.activeScrollLeft();
        const right = self.activeScrollRight();
        return self.cursor_x >= left and self.cursor_x <= right;
    }

    fn inLineOpRegion(self: *const TerminalHandle) bool {
        return self.cursorInVerticalRegion() and self.cursorInHorizontalRegion();
    }

    fn regionColumnRange(self: *const TerminalHandle) struct { left: usize, right: usize } {
        return .{
            .left = self.activeScrollLeft(),
            .right = self.activeScrollRight(),
        };
    }

    fn setCursorHome(self: *TerminalHandle) void {
        if (self.origin_mode) {
            self.cursor_x = self.activeScrollLeft();
            self.cursor_y = self.scroll_top;
            return;
        }
        self.cursor_x = 0;
        self.cursor_y = 0;
    }

    fn putCodepoint(self: *TerminalHandle, cp: u21) void {
        if (self.cols == 0 or self.rows == 0) return;
        var width = codepointWidth(cp);
        var width_usize: usize = width;

        // Resolve deferred wrap from a previous character at the last column.
        if (self.pending_wrap and self.wraparound) {
            self.pending_wrap = false;
            self.cursor_x = 0;
            self.linefeed();
        }
        self.pending_wrap = false;

        if (width_usize == 2 and self.cursor_x + 1 >= self.cols) {
            if (self.wraparound) {
                self.cursor_x = 0;
                self.linefeed();
            } else {
                width = 1;
                width_usize = 1;
            }
        }

        if (self.cursor_x >= self.cols or self.cursor_y >= self.rows) return;

        const idx = self.index(self.cursor_x, self.cursor_y);
        self.cells[idx] = self.textCell(cp, width);

        if (width_usize == 2 and self.cursor_x + 1 < self.cols) {
            const spacer_idx = self.index(self.cursor_x + 1, self.cursor_y);
            self.cells[spacer_idx] = self.spacerCell();
        }

        self.markRowDirty(self.cursor_y);
        self.last_codepoint = cp;

        if (self.cursor_x + width_usize >= self.cols) {
            // Defer the wrap — cursor stays at last column until the next
            // printable character.  CR / LF / cursor-movement just clear the flag.
            self.pending_wrap = true;
            if (!self.wraparound) {
                self.cursor_x = self.cols - 1;
            }
            return;
        }

        self.cursor_x += width_usize;
    }

    fn linefeed(self: *TerminalHandle) void {
        self.pending_wrap = false;
        if (self.rows == 0) return;
        if (self.cursor_y == self.scroll_bottom and self.cursorInHorizontalRegion()) {
            self.scrollUp(1);
            self.cursor_y = self.scroll_bottom;
            return;
        }
        if (self.cursor_y + 1 >= self.rows) {
            self.cursor_y = self.rows - 1;
            return;
        }
        self.cursor_y += 1;
    }

    fn reverseIndex(self: *TerminalHandle) void {
        self.pending_wrap = false;
        if (self.rows == 0) return;
        if (self.cursor_y == self.scroll_top and self.cursorInHorizontalRegion()) {
            self.scrollDown(1);
            return;
        }
        if (self.cursor_y > 0) {
            self.cursor_y -= 1;
            return;
        }
    }

    fn backspace(self: *TerminalHandle) void {
        self.pending_wrap = false;
        if (self.cursor_x > 0) self.cursor_x -= 1;
    }

    fn carriageReturn(self: *TerminalHandle) void {
        self.pending_wrap = false;
        if (self.enable_left_right_margin) {
            self.cursor_x = self.activeScrollLeft();
            return;
        }
        self.cursor_x = 0;
    }

    fn moveCursorRelative(self: *TerminalHandle, dx: i32, dy: i32) void {
        self.pending_wrap = false;
        const x = @as(i32, @intCast(self.cursor_x)) + dx;
        const y = @as(i32, @intCast(self.cursor_y)) + dy;
        self.cursor_x = clampIndex(x, self.cols);
        self.cursor_y = clampIndex(y, self.rows);
    }

    fn setCursorPos(self: *TerminalHandle, row: u16, col: u16) void {
        self.pending_wrap = false;
        if (self.cols == 0 or self.rows == 0) return;
        const y = @max(@as(usize, @intCast(row)), 1) - 1;
        const x = @max(@as(usize, @intCast(col)), 1) - 1;
        if (self.origin_mode) {
            const left = self.activeScrollLeft();
            self.cursor_x = @min(left + x, self.activeScrollRight());
            self.cursor_y = @min(self.scroll_top + y, self.scroll_bottom);
            return;
        }
        self.cursor_x = @min(x, self.cols - 1);
        self.cursor_y = @min(y, self.rows - 1);
    }

    fn setCursorCol(self: *TerminalHandle, col: u16) void {
        self.pending_wrap = false;
        if (self.cols == 0) return;
        const x = @max(@as(usize, @intCast(col)), 1) - 1;
        const left = if (self.origin_mode) self.activeScrollLeft() else 0;
        self.cursor_x = @min(left + x, self.activeScrollRight());
    }

    fn setCursorRow(self: *TerminalHandle, row: u16) void {
        self.pending_wrap = false;
        if (self.rows == 0) return;
        const y = @max(@as(usize, @intCast(row)), 1) - 1;
        if (self.origin_mode) {
            self.cursor_y = @min(self.scroll_top + y, self.scroll_bottom);
            return;
        }
        self.cursor_y = @min(y, self.rows - 1);
    }

    fn horizontalTab(self: *TerminalHandle, count_raw: u16) void {
        self.pending_wrap = false;
        const count = @max(@as(usize, @intCast(count_raw)), 1);
        for (0..count) |_| {
            const next = ((self.cursor_x / default_tab_width) + 1) * default_tab_width;
            if (next >= self.cols) {
                self.cursor_x = self.cols - 1;
                return;
            }
            self.cursor_x = next;
        }
    }

    fn horizontalTabBack(self: *TerminalHandle, count_raw: u16) void {
        self.pending_wrap = false;
        const count = @max(@as(usize, @intCast(count_raw)), 1);
        for (0..count) |_| {
            if (self.cursor_x == 0) return;
            const prev = ((self.cursor_x - 1) / default_tab_width) * default_tab_width;
            self.cursor_x = prev;
        }
    }

    fn eraseLine(self: *TerminalHandle, mode: EraseLineMode) void {
        if (self.rows == 0) return;
        const row = self.rowSlice(self.cursor_y);
        const blank = self.blankCell();
        switch (mode) {
            .right => @memset(row[self.cursor_x..], blank),
            .left => @memset(row[0 .. self.cursor_x + 1], blank),
            .complete => @memset(row, blank),
        }
        self.markRowDirty(self.cursor_y);
    }

    fn eraseDisplay(self: *TerminalHandle, mode: EraseDisplayMode) void {
        if (self.rows == 0) return;
        const blank = self.blankCell();
        switch (mode) {
            .below => {
                self.eraseLine(.right);
                if (self.cursor_y + 1 < self.rows) {
                    for (self.cursor_y + 1..self.rows) |y| {
                        @memset(self.rowSlice(y), blank);
                        self.markRowDirty(y);
                    }
                }
            },
            .above => {
                if (self.cursor_y > 0) {
                    for (0..self.cursor_y) |y| {
                        @memset(self.rowSlice(y), blank);
                        self.markRowDirty(y);
                    }
                }
                self.eraseLine(.left);
            },
            .complete => {
                @memset(self.cells, blank);
                self.markAllDirty();
            },
        }
    }

    fn insertBlanks(self: *TerminalHandle, count_raw: usize) void {
        if (count_raw == 0 or self.cols == 0) return;
        const count = @min(count_raw, self.cols - self.cursor_x);
        if (count == 0) return;
        const row = self.rowSlice(self.cursor_y);
        std.mem.copyBackwards(
            EncodedCell,
            row[self.cursor_x + count ..],
            row[self.cursor_x .. row.len - count],
        );
        @memset(row[self.cursor_x .. self.cursor_x + count], self.blankCell());
        self.markRowDirty(self.cursor_y);
    }

    fn deleteChars(self: *TerminalHandle, count_raw: usize) void {
        if (count_raw == 0 or self.cols == 0) return;
        const count = @min(count_raw, self.cols - self.cursor_x);
        if (count == 0) return;
        const row = self.rowSlice(self.cursor_y);
        std.mem.copyForwards(
            EncodedCell,
            row[self.cursor_x .. row.len - count],
            row[self.cursor_x + count ..],
        );
        @memset(row[row.len - count ..], self.blankCell());
        self.markRowDirty(self.cursor_y);
    }

    fn eraseChars(self: *TerminalHandle, count_raw: usize) void {
        if (count_raw == 0 or self.cols == 0) return;
        const count = @min(count_raw, self.cols - self.cursor_x);
        if (count == 0) return;
        const row = self.rowSlice(self.cursor_y);
        @memset(row[self.cursor_x .. self.cursor_x + count], self.blankCell());
        self.markRowDirty(self.cursor_y);
    }

    fn insertLines(self: *TerminalHandle, count_raw: usize) void {
        if (count_raw == 0 or self.rows == 0 or !self.inLineOpRegion()) return;
        const left_right = self.regionColumnRange();
        const top = self.scroll_top;
        const bottom = self.scroll_bottom;
        const count = @min(count_raw, bottom - self.cursor_y + 1);
        if (count == 0) return;

        var y: usize = bottom - count + 1;
        while (y > self.cursor_y) {
            y -= 1;
            self.copyRowRegion(y + count, y, left_right.left, left_right.right);
            self.markRowDirty(y + count);
        }

        for (self.cursor_y..self.cursor_y + count) |row| {
            if (row < top or row > bottom) continue;
            self.fillRowRegion(row, left_right.left, left_right.right, self.blankCell());
            self.markRowDirty(row);
        }
    }

    fn deleteLines(self: *TerminalHandle, count_raw: usize) void {
        if (count_raw == 0 or self.rows == 0 or !self.inLineOpRegion()) return;
        const left_right = self.regionColumnRange();
        const bottom = self.scroll_bottom;
        const count = @min(count_raw, bottom - self.cursor_y + 1);
        if (count == 0) return;

        var y = self.cursor_y;
        while (y + count <= bottom) : (y += 1) {
            self.copyRowRegion(y, y + count, left_right.left, left_right.right);
            self.markRowDirty(y);
        }

        for (bottom - count + 1..bottom + 1) |row| {
            self.fillRowRegion(row, left_right.left, left_right.right, self.blankCell());
            self.markRowDirty(row);
        }
    }

    fn scrollUp(self: *TerminalHandle, count_raw: usize) void {
        if (self.rows == 0 or count_raw == 0) return;
        const left_right = self.regionColumnRange();
        const top = self.scroll_top;
        const bottom = self.scroll_bottom;
        const count = @min(count_raw, bottom - top + 1);
        if (count == 0) return;

        var y = top;
        while (y + count <= bottom) : (y += 1) {
            self.copyRowRegion(y, y + count, left_right.left, left_right.right);
            self.markRowDirty(y);
        }

        for (bottom - count + 1..bottom + 1) |row| {
            self.fillRowRegion(row, left_right.left, left_right.right, self.blankCell());
            self.markRowDirty(row);
        }
    }

    fn scrollDown(self: *TerminalHandle, count_raw: usize) void {
        if (self.rows == 0 or count_raw == 0) return;
        const left_right = self.regionColumnRange();
        const top = self.scroll_top;
        const bottom = self.scroll_bottom;
        const count = @min(count_raw, bottom - top + 1);
        if (count == 0) return;

        var y: usize = bottom - count + 1;
        while (y > top) {
            y -= 1;
            self.copyRowRegion(y + count, y, left_right.left, left_right.right);
            self.markRowDirty(y + count);
        }

        for (top..top + count) |row| {
            self.fillRowRegion(row, left_right.left, left_right.right, self.blankCell());
            self.markRowDirty(row);
        }
    }

    fn copyRowRegion(
        self: *TerminalHandle,
        dst_row: usize,
        src_row: usize,
        left: usize,
        right: usize,
    ) void {
        const dst = self.rowSlice(dst_row);
        const src = self.rowSlice(src_row);
        std.mem.copyForwards(EncodedCell, dst[left .. right + 1], src[left .. right + 1]);
    }

    fn fillRowRegion(
        self: *TerminalHandle,
        row: usize,
        left: usize,
        right: usize,
        cell: EncodedCell,
    ) void {
        const row_data = self.rowSlice(row);
        @memset(row_data[left .. right + 1], cell);
    }

    fn setMode(self: *TerminalHandle, mode: anytype, enabled: bool) void {
        switch (mode) {
            .wraparound => self.wraparound = enabled,
            .origin => {
                self.origin_mode = enabled;
                self.setCursorHome();
            },
            .enable_left_and_right_margin => {
                self.enable_left_right_margin = enabled;
                if (!enabled) {
                    self.scroll_left = 0;
                    self.scroll_right = self.cols - 1;
                }
            },
            else => {},
        }
    }

    fn setTopAndBottomMargin(self: *TerminalHandle, top_req: u16, bottom_req: u16) void {
        if (self.rows == 0) return;
        const top = @max(@as(usize, top_req), 1);
        const bottom = @min(self.rows, if (bottom_req == 0) self.rows else @as(usize, bottom_req));
        if (top >= bottom) return;

        self.scroll_top = top - 1;
        self.scroll_bottom = bottom - 1;
        self.setCursorHome();
    }

    fn setLeftAndRightMargin(self: *TerminalHandle, left_req: u16, right_req: u16) void {
        if (!self.enable_left_right_margin or self.cols == 0) return;
        const left = @max(@as(usize, left_req), 1);
        const right = @min(self.cols, if (right_req == 0) self.cols else @as(usize, right_req));
        if (left >= right) return;

        self.scroll_left = left - 1;
        self.scroll_right = right - 1;
        self.setCursorHome();
    }

    fn handleAmbiguousMargin(self: *TerminalHandle) void {
        if (self.enable_left_right_margin) {
            self.setLeftAndRightMargin(0, 0);
            return;
        }
        self.saved_x = self.cursor_x;
        self.saved_y = self.cursor_y;
    }

    fn applyAttribute(self: *TerminalHandle, attr: anytype) void {
        switch (attr) {
            .unset => self.style = .{},
            .bold => self.style.bold = true,
            .reset_bold => {
                self.style.bold = false;
                self.style.faint = false;
            },
            .italic => self.style.italic = true,
            .reset_italic => self.style.italic = false,
            .faint => self.style.faint = true,
            .underline => |kind| self.style.underline = kind != .none,
            .inverse => self.style.inverse = true,
            .reset_inverse => self.style.inverse = false,
            .invisible => self.style.invisible = true,
            .reset_invisible => self.style.invisible = false,
            .direct_color_fg => |rgb| self.style.fg = fromGhosttyRgb(rgb),
            .direct_color_bg => |rgb| self.style.bg = fromGhosttyRgb(rgb),
            .@"8_fg" => |name| self.style.fg = self.palette[@intFromEnum(name)],
            .@"8_bg" => |name| self.style.bg = self.palette[@intFromEnum(name)],
            .@"8_bright_fg" => |name| self.style.fg = self.palette[@intFromEnum(name)],
            .@"8_bright_bg" => |name| self.style.bg = self.palette[@intFromEnum(name)],
            .@"256_fg" => |idx| self.style.fg = colorFrom256(self.palette, idx),
            .@"256_bg" => |idx| self.style.bg = colorFrom256(self.palette, idx),
            .reset_fg => self.style.fg = null,
            .reset_bg => self.style.bg = null,
            else => {},
        }
    }

    fn handleDeviceStatus(self: *TerminalHandle, req: anytype) void {
        switch (req) {
            .operating_status => self.appendResponse("\x1b[0n"),
            .cursor_position => {
                var buf: [32]u8 = undefined;
                const message = std.fmt.bufPrint(
                    &buf,
                    "\x1b[{};{}R",
                    .{ self.cursor_y + 1, self.cursor_x + 1 },
                ) catch return;
                self.appendResponse(message);
            },
            else => {},
        }
    }

    fn handleSizeReport(self: *TerminalHandle, style: anytype) void {
        _ = style;
        var buf: [32]u8 = undefined;
        const message = std.fmt.bufPrint(
            &buf,
            "\x1b[8;{};{}t",
            .{ self.rows, self.cols },
        ) catch return;
        self.appendResponse(message);
    }

    fn handleDeviceAttributes(self: *TerminalHandle, req: anytype) void {
        _ = req;
        self.appendResponse("\x1b[?1;2c");
    }

    fn appendResponse(self: *TerminalHandle, bytes: []const u8) void {
        self.responses.appendSlice(alloc, bytes) catch {};
    }

    fn fullReset(self: *TerminalHandle) void {
        self.cursor_x = 0;
        self.cursor_y = 0;
        self.saved_x = 0;
        self.saved_y = 0;
        self.pending_wrap = false;
        self.wraparound = true;
        self.origin_mode = false;
        self.enable_left_right_margin = false;
        self.resetScrollRegion();
        self.style = .{};
        self.responses.clearRetainingCapacity();
        @memset(self.cells, EncodedCell{});
        self.markAllDirty();
    }

    fn blankCell(self: *TerminalHandle) EncodedCell {
        var cell: EncodedCell = .{};
        var bg = self.style.bg;
        if (self.style.inverse) bg = self.style.fg orelse self.default_fg;
        if (bg) |rgb| {
            cell.bg_r = rgb.r;
            cell.bg_g = rgb.g;
            cell.bg_b = rgb.b;
            cell.flags |= flag_bg_explicit;
            cell.width = 1;
        }
        return cell;
    }

    fn spacerCell(self: *TerminalHandle) EncodedCell {
        var cell = self.blankCell();
        cell.codepoint = 0;
        cell.width = 0;
        return cell;
    }

    fn textCell(self: *TerminalHandle, cp: u21, width: u8) EncodedCell {
        var cell: EncodedCell = .{
            .codepoint = cp,
            .width = width,
        };

        if (self.style.bold) cell.flags |= flag_bold;
        if (self.style.italic) cell.flags |= flag_italic;
        if (self.style.underline) cell.flags |= flag_underline;
        if (self.style.inverse) cell.flags |= flag_inverse;
        if (self.style.invisible) cell.flags |= flag_invisible;
        if (self.style.faint) cell.flags |= flag_faint;

        var fg = self.style.fg;
        var bg = self.style.bg;
        if (self.style.inverse) {
            if (fg == null) fg = self.default_fg;
            if (bg == null) bg = self.default_bg;
        }

        if (fg) |rgb| {
            cell.fg_r = rgb.r;
            cell.fg_g = rgb.g;
            cell.fg_b = rgb.b;
            cell.flags |= flag_fg_explicit;
        }
        if (bg) |rgb| {
            cell.bg_r = rgb.r;
            cell.bg_g = rgb.g;
            cell.bg_b = rgb.b;
            cell.flags |= flag_bg_explicit;
        }

        return cell;
    }
};

fn clampIndex(value: i32, max_len: usize) usize {
    if (max_len == 0) return 0;
    if (value <= 0) return 0;
    const max_i32 = @as(i32, @intCast(max_len - 1));
    return @intCast(@min(value, max_i32));
}

fn clampDimension(raw: u32) usize {
    const max = 4096;
    if (raw == 0) return 1;
    const as_usize: usize = @intCast(raw);
    return @min(as_usize, max);
}

fn codepointWidth(cp: u21) u8 {
    return if (isWideCodepoint(cp)) 2 else 1;
}

fn isWideCodepoint(cp: u21) bool {
    if (cp < 0x1100) return false;
    return cp <= 0x115F or
        cp == 0x2329 or
        cp == 0x232A or
        (cp >= 0x2E80 and cp <= 0xA4CF and cp != 0x303F) or
        (cp >= 0xAC00 and cp <= 0xD7A3) or
        (cp >= 0xF900 and cp <= 0xFAFF) or
        (cp >= 0xFE10 and cp <= 0xFE19) or
        (cp >= 0xFE30 and cp <= 0xFE6F) or
        (cp >= 0xFF00 and cp <= 0xFF60) or
        (cp >= 0xFFE0 and cp <= 0xFFE6) or
        (cp >= 0x1F300 and cp <= 0x1FAFF) or
        (cp >= 0x20000 and cp <= 0x3FFFD);
}

fn readU32Le(bytes: [*]const u8, offset: usize) u32 {
    return @as(u32, bytes[offset]) |
        (@as(u32, bytes[offset + 1]) << 8) |
        (@as(u32, bytes[offset + 2]) << 16) |
        (@as(u32, bytes[offset + 3]) << 24);
}

fn rgbFromHex(value: u32) Rgb {
    return .{
        .r = @intCast((value >> 16) & 0xFF),
        .g = @intCast((value >> 8) & 0xFF),
        .b = @intCast(value & 0xFF),
    };
}

fn fromGhosttyRgb(value: anytype) Rgb {
    return .{
        .r = value.r,
        .g = value.g,
        .b = value.b,
    };
}

fn colorFrom256(palette16: [16]Rgb, idx: u8) Rgb {
    if (idx < 16) {
        return palette16[idx];
    }

    if (idx >= 232) {
        const v = @as(u8, @intCast(((idx - 232) * 10) + 8));
        return .{ .r = v, .g = v, .b = v };
    }

    const cube = idx - 16;
    const r = cube / 36;
    const g = (cube % 36) / 6;
    const b = cube % 6;

    return .{
        .r = if (r == 0) 0 else @as(u8, @intCast((r * 40) + 55)),
        .g = if (g == 0) 0 else @as(u8, @intCast((g * 40) + 55)),
        .b = if (b == 0) 0 else @as(u8, @intCast((b * 40) + 55)),
    };
}

fn createTerminal(
    cols_raw: u32,
    rows_raw: u32,
    config_ptr: ?[*]const u8,
) ?*TerminalHandle {
    const cols = clampDimension(cols_raw);
    const rows = clampDimension(rows_raw);
    const count = std.math.mul(usize, cols, rows) catch return null;

    const handle = alloc.create(TerminalHandle) catch return null;
    errdefer alloc.destroy(handle);

    const cells = alloc.alloc(EncodedCell, count) catch return null;
    errdefer alloc.free(cells);
    const dirty_rows = alloc.alloc(bool, rows) catch return null;
    errdefer alloc.free(dirty_rows);

    @memset(cells, EncodedCell{});
    @memset(dirty_rows, true);

    handle.* = .{
        .cols = cols,
        .rows = rows,
        .cells = cells,
        .dirty_rows = dirty_rows,
    };
    handle.resetScrollRegion();

    if (config_ptr) |cfg| {
        handle.default_fg = rgbFromHex(readU32Le(cfg, 4));
        handle.default_bg = rgbFromHex(readU32Le(cfg, 8));
        handle.cursor_color = rgbFromHex(readU32Le(cfg, 12));
        for (0..16) |idx| {
            handle.palette[idx] = rgbFromHex(readU32Le(cfg, 16 + idx * 4));
        }
    }

    handle.stream = Stream.init(.{ .term = @ptrCast(handle) });
    return handle;
}

pub export fn ghostty_wasm_alloc_u8_array(len: usize) ?[*]u8 {
    if (len == 0) return null;
    const memory = alloc.alloc(u8, len) catch return null;
    return memory.ptr;
}

pub export fn ghostty_wasm_free_u8_array(ptr: [*]u8, len: usize) void {
    if (len == 0) return;
    alloc.free(ptr[0..len]);
}

pub export fn ghostty_terminal_new(cols: u32, rows: u32) ?*TerminalHandle {
    return createTerminal(cols, rows, null);
}

pub export fn ghostty_terminal_new_with_config(
    cols: u32,
    rows: u32,
    config_ptr: ?[*]const u8,
) ?*TerminalHandle {
    return createTerminal(cols, rows, config_ptr);
}

pub export fn ghostty_terminal_free(handle: ?*TerminalHandle) void {
    const h = handle orelse return;
    h.deinit();
    alloc.destroy(h);
}

pub export fn ghostty_terminal_resize(handle: ?*TerminalHandle, cols: u32, rows: u32) void {
    const h = handle orelse return;
    h.resize(cols, rows);
}

pub export fn ghostty_terminal_write(
    handle: ?*TerminalHandle,
    data_ptr: [*]const u8,
    data_len: usize,
) void {
    const h = handle orelse return;
    if (data_len == 0) return;
    h.stream.nextSlice(data_ptr[0..data_len]) catch {};
}

pub export fn ghostty_render_state_update(handle: ?*TerminalHandle) u32 {
    const h = handle orelse return 0;
    return if (h.dirty_any) 1 else 0;
}

pub export fn ghostty_render_state_get_cols(handle: ?*TerminalHandle) u32 {
    const h = handle orelse return 0;
    return @intCast(h.cols);
}

pub export fn ghostty_render_state_get_rows(handle: ?*TerminalHandle) u32 {
    const h = handle orelse return 0;
    return @intCast(h.rows);
}

pub export fn ghostty_render_state_is_row_dirty(handle: ?*TerminalHandle, row: u32) bool {
    const h = handle orelse return false;
    const idx: usize = @intCast(row);
    if (idx >= h.dirty_rows.len) return false;
    return h.dirty_rows[idx];
}

pub export fn ghostty_render_state_mark_clean(handle: ?*TerminalHandle) void {
    const h = handle orelse return;
    @memset(h.dirty_rows, false);
    h.dirty_any = false;
}

pub export fn ghostty_render_state_get_viewport(
    handle: ?*TerminalHandle,
    buffer_ptr: [*]u8,
    buffer_len: usize,
) usize {
    const h = handle orelse return 0;
    const raw = std.mem.sliceAsBytes(h.cells);
    const size = @min(raw.len, buffer_len);
    if (size == 0) return 0;
    std.mem.copyForwards(u8, buffer_ptr[0..size], raw[0..size]);
    return size;
}

pub export fn ghostty_terminal_has_response(handle: ?*TerminalHandle) bool {
    const h = handle orelse return false;
    return h.responses.items.len > 0;
}

pub export fn ghostty_terminal_read_response(
    handle: ?*TerminalHandle,
    buffer_ptr: [*]u8,
    buffer_len: usize,
) isize {
    const h = handle orelse return 0;
    if (buffer_len == 0 or h.responses.items.len == 0) return 0;

    const n = @min(buffer_len, h.responses.items.len);
    std.mem.copyForwards(u8, buffer_ptr[0..n], h.responses.items[0..n]);
    if (n < h.responses.items.len) {
        std.mem.copyForwards(u8, h.responses.items[0 .. h.responses.items.len - n], h.responses.items[n..]);
    }
    h.responses.items.len -= n;
    return @intCast(n);
}
