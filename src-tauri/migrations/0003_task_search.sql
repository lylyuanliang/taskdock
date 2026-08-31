CREATE VIRTUAL TABLE todo_task_search USING fts5(
  title,
  note,
  content = 'todo_tasks',
  content_rowid = 'rowid'
);

CREATE TRIGGER todo_task_search_insert
AFTER INSERT ON todo_tasks
BEGIN
  INSERT INTO todo_task_search (rowid, title, note)
  VALUES (NEW.rowid, NEW.title, NEW.note);
END;

CREATE TRIGGER todo_task_search_delete
AFTER DELETE ON todo_tasks
BEGIN
  INSERT INTO todo_task_search (todo_task_search, rowid, title, note)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.note);
END;

CREATE TRIGGER todo_task_search_update
AFTER UPDATE OF title, note ON todo_tasks
BEGIN
  INSERT INTO todo_task_search (todo_task_search, rowid, title, note)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.note);
  INSERT INTO todo_task_search (rowid, title, note)
  VALUES (NEW.rowid, NEW.title, NEW.note);
END;

INSERT INTO todo_task_search (rowid, title, note)
SELECT rowid, title, note FROM todo_tasks;
